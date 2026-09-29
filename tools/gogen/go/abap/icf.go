package abap

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The host side of the ICF shim (express-icf-shim's cl_express_icf_shim).
//
// On Node the shim's kernel lines read an express request and write an
// express response (WRITE '@KERNEL ...'). Here the same lines are calls into
// these functions (frontend.mjs KERNEL), and the request and the response are
// one ICFExchange, which the host passes as the shim's REQ and RES (both TYPE
// any, so a Data whose P is the exchange). The ABAP between the lines -- the
// ICF objects, the header table, the form fields, the handler -- is the
// shim's own, compiled.
//
// What each function answers is what express answers to the JavaScript it
// replaces, since that is the host the ABAP was written against:
//
//	INPUT.class                 Class
//	req.body (hex, upper case)  Body, raw bytes (an xstring is its bytes here)
//	req.method                  Method
//	req.headers                 Headers: lower-case names, in the host's order
//	req.url                     URL: path and query as the request line had them
//	req.path                    Path: the URL without its query, not decoded
//	res.append(name, value)     Append
//	res.status(n).send(buffer)  Send
type ICFExchange struct {
	Class   string
	Method  string
	URL     string
	Path    string
	Headers [][2]string
	Body    []byte

	Status      int32
	RespHeaders [][2]string
	RespBody    []byte
	Sent        bool
}

func icfExchange(d Data, where string) *ICFExchange {
	x, ok := d.P.(*ICFExchange)
	if !ok || x == nil {
		panic(NotCompiled(where, "the ICF shim was called without a host exchange (REQ / RES)"))
	}
	return x
}

// ICFClass is INPUT.class: the handler class the host asks the shim to run.
func ICFClass(s *Session, req Data, out *string) {
	*out = icfExchange(req, "CL_EXPRESS_ICF_SHIM=>RUN").Class
}

// ICFRequestBody is req.body; the shim moves it into an xstring.
func ICFRequestBody(s *Session, req Data, out *string) {
	*out = string(icfExchange(req, "CL_EXPRESS_ICF_SHIM=>REQUEST").Body)
}

func ICFRequestMethod(s *Session, req Data, out *string) {
	*out = icfExchange(req, "CL_EXPRESS_ICF_SHIM=>REQUEST").Method
}

// ICFRequestHeaders is for (const h in req.headers): each name with its value.
func ICFRequestHeaders(s *Session, req Data) [][2]string {
	return icfExchange(req, "CL_EXPRESS_ICF_SHIM=>REQUEST").Headers
}

func ICFRequestURL(s *Session, req Data, out *string) {
	*out = icfExchange(req, "CL_EXPRESS_ICF_SHIM=>REQUEST").URL
}

func ICFRequestPath(s *Session, req Data, out *string) {
	*out = icfExchange(req, "CL_EXPRESS_ICF_SHIM=>REQUEST").Path
}

// HostError is the host refusing what the ABAP asked of it: a contract of
// the host (express's, here) that the call broke. It is not a compiler gap
// (NotCompiled) and not an ABAP exception, so no CATCH takes it; the dialog
// step ends in it as a dump.
type HostError struct {
	Where string
	Text  string
}

func (e HostError) Error() string { return e.Where + ": " + e.Text }

// ICFResponseAppend is res.append(name, value): a header line more, however
// many of that name there are already -- except Content-Type, where express's
// append makes an array and res.set throws "Content-Type cannot be set to an
// Array" (a TypeError inside the kernel line, so a dump on Node too).
func ICFResponseAppend(s *Session, res Data, name, value string) {
	x := icfExchange(res, "CL_EXPRESS_ICF_SHIM=>RESPONSE")
	if strings.EqualFold(name, "content-type") {
		for _, f := range x.RespHeaders {
			if strings.EqualFold(f[0], "content-type") {
				panic(HostError{"CL_EXPRESS_ICF_SHIM=>RESPONSE", "a second Content-Type (express: Content-Type cannot be set to an Array)"})
			}
		}
	}
	x.RespHeaders = append(x.RespHeaders, [2]string{name, value})
}

// ICFResponseSend is res.status(code).send(buffer). A second send is an
// error on express ("headers already sent"), a host error here.
func ICFResponseSend(s *Session, res Data, code int32, body string) {
	x := icfExchange(res, "CL_EXPRESS_ICF_SHIM=>RESPONSE")
	if x.Sent {
		panic(HostError{"CL_EXPRESS_ICF_SHIM=>RESPONSE", "the response was sent twice (express: headers already sent)"})
	}
	x.Status = code
	x.RespBody = []byte(body)
	x.Sent = true
}

// ICFGetCData is CL_HTTP_ENTITY's get_cdata: the body read as UTF-8. It is
// open-abap-core's CL_ABAP_CONV_IN_CE with encoding UTF-8 and ignore_cerr
// off: TextDecoder with fatal and ignoreBOM, so a byte order mark stays in
// the text and bytes that are not UTF-8 raise CX_SY_CONVERSION_CODEPAGE.
func ICFGetCData(s *Session, data string) string {
	if !utf8.ValidString(data) {
		panic(ArithmeticError{"CX_SY_CONVERSION_CODEPAGE", "get_cdata: the body is not UTF-8"})
	}
	return data
}

// ICFSetCData is set_cdata: the text as UTF-8 bytes, which is how a string
// is held here already.
func ICFSetCData(s *Session, buffer *string, data string) {
	*buffer = data
}

// Node keeps the first of these when a request repeats them, joins cookie
// with "; " and every other name with ", " (http.IncomingMessage).
var nodeFirstWins = map[string]bool{"age": true, "authorization": true, "content-length": true, "content-type": true, "etag": true,
	"expires": true, "from": true, "host": true, "if-modified-since": true, "if-unmodified-since": true, "last-modified": true,
	"location": true, "max-forwards": true, "proxy-authorization": true, "referer": true, "retry-after": true, "server": true, "user-agent": true}

// ICFBodyLimit is express.raw's limit in the Node hosts (16mb).
const ICFBodyLimit = 16 << 20

// ICFRequestError is a request the body parser refuses before the ABAP runs:
// the status and the text express answers with.
type ICFRequestError struct {
	Status int
	Text   string
}

func (e *ICFRequestError) Error() string { return e.Text }

// NewICFExchange reads a request the way the Node hosts see it: express with
// express.raw({type: "*\/*", limit: "16mb"}) in front of the shim. Headers
// come lower case as Node gives them, sorted by name (Go does not keep the
// order they arrived in, Node does); the body is read only when the request
// has a Content-Type (type-is: no type, no body), inflated when it is gzip or
// deflate, and refused above the limit (413) or in another encoding (415).
func NewICFExchange(r *http.Request, class string) (*ICFExchange, error) {
	x := &ICFExchange{Class: class, Method: r.Method, URL: r.RequestURI}
	if strings.HasPrefix(x.URL, "http://") || strings.HasPrefix(x.URL, "https://") {
		x.URL = r.URL.RequestURI()
	}
	x.Path, _, _ = strings.Cut(x.URL, "?")
	joined := map[string]string{}
	add := func(name, value string) {
		name = strings.ToLower(name)
		prev, seen := joined[name]
		switch {
		case !seen:
			joined[name] = value
		case nodeFirstWins[name]:
		case name == "cookie":
			joined[name] = prev + "; " + value
		default:
			joined[name] = prev + ", " + value
		}
	}
	if r.Host != "" {
		add("host", r.Host)
	}
	for name, values := range r.Header {
		for _, v := range values {
			add(name, v)
		}
	}
	if len(r.TransferEncoding) > 0 {
		add("transfer-encoding", strings.Join(r.TransferEncoding, ", "))
	}
	names := make([]string, 0, len(joined))
	for n := range joined {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		x.Headers = append(x.Headers, [2]string{n, joined[n]})
	}
	if r.Body == nil || r.Header.Get("Content-Type") == "" || (r.ContentLength == 0 && len(r.TransferEncoding) == 0) {
		return x, nil
	}
	var in io.Reader = r.Body
	switch enc := strings.ToLower(r.Header.Get("Content-Encoding")); enc {
	case "", "identity":
	case "gzip":
		z, err := gzip.NewReader(r.Body)
		if err != nil {
			return nil, &ICFRequestError{400, "invalid gzip body"}
		}
		in = z
	case "deflate":
		z, err := zlib.NewReader(r.Body) // body-parser: zlib.createInflate
		if err != nil {
			return nil, &ICFRequestError{400, "invalid deflate body"}
		}
		in = z
	default:
		return nil, &ICFRequestError{415, "unsupported content encoding \"" + enc + "\""}
	}
	body, err := io.ReadAll(io.LimitReader(in, ICFBodyLimit+1))
	if err != nil {
		return nil, &ICFRequestError{400, "request aborted"}
	}
	if len(body) > ICFBodyLimit {
		return nil, &ICFRequestError{413, "request entity too large"}
	}
	x.Body = body
	return x, nil
}

var charsetRe = regexp.MustCompile(`;\s*charset\s*=`)
var utf8Types = regexp.MustCompile(`^text/|^application/(javascript|json)`)

// Write answers what the shim sent, with what express adds on the way:
// res.set gives a text or JSON content type "; charset=utf-8" (mime 1.x's
// charsets.lookup), res.send sets Content-Length, strips the body and its
// headers from a 204 or 304, empties a 205 and sends no body to a HEAD.
func (x *ICFExchange) Write(w http.ResponseWriter, method string) {
	h := w.Header()
	for _, f := range x.RespHeaders {
		name, value := f[0], f[1]
		if strings.EqualFold(name, "content-type") && !charsetRe.MatchString(value) {
			// mime.charsets.lookup(value.split(';')[0]): not trimmed
			if utf8Types.MatchString(strings.SplitN(value, ";", 2)[0]) {
				value += "; charset=utf-8"
			}
		}
		// canonical in Go's map, or net/http does not see the content type
		// it would otherwise sniff and send a second one (names are
		// case-insensitive on the wire; Node sends them as written)
		h.Add(name, value)
	}
	body := x.RespBody
	code := int(x.Status)
	switch code {
	case 204, 304:
		for k := range h {
			if lk := strings.ToLower(k); lk == "content-type" || lk == "content-length" || lk == "transfer-encoding" {
				delete(h, k)
			}
		}
		body = nil
	case 205:
		body = nil
	}
	if code != 204 && code != 304 {
		h["Content-Length"] = []string{strconv.Itoa(len(body))}
	}
	w.WriteHeader(code)
	if method != "HEAD" && len(body) > 0 {
		io.Copy(w, bytes.NewReader(body))
	}
}

// XStringToStringUTF8 is ZCL_ABAPGIT_CONVERT=>XSTRING_TO_STRING_UTF8
// (ultra/events): the first n bytes of data (all when n <= 0) as UTF-8. On
// a system a byte sequence that is not UTF-8 is a ZCX_ABAPGIT_EXCEPTION the
// host cannot make, so here it is refused.
func XStringToStringUTF8(s *Session, data string, n int32) string {
	if n > 0 && int(n) < len(data) {
		data = data[:n]
	}
	if !utf8.ValidString(data) {
		panic(NotCompiled("ZCL_ABAPGIT_CONVERT=>XSTRING_TO_STRING_UTF8", "bytes that are not UTF-8: the ZCX_ABAPGIT_EXCEPTION is not made by the host"))
	}
	return data
}
