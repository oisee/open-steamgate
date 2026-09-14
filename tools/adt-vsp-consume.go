// Feed captured successful ADT responses to the actual VSP client, offline.
// Run from a VSP checkout: go run /path/to/adt-vsp-consume.go --out ... FILE...
// The injected HTTPDoer cannot open sockets. Synthetic CSRF HEAD is explicit.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/oisee/vibing-steampunk/pkg/adt"
)

type part struct {
	Status  int                    `json:"status"`
	Headers map[string]interface{} `json:"headers"`
	Body    struct {
		Base64    string `json:"base64"`
		Truncated bool   `json:"truncated"`
	} `json:"body"`
}
type exchange struct {
	Method   string `json:"method"`
	URL      string `json:"url"`
	Request  part   `json:"request"`
	Response part   `json:"response"`
}
type consumer struct {
	row      exchange
	body     []byte
	requests []map[string]string
	used     bool
}

func (c *consumer) Do(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
	}
	c.requests = append(c.requests, map[string]string{"method": req.Method, "path": req.URL.EscapedPath(),
		"query": req.URL.RawQuery, "accept": req.Header.Get("Accept"), "content_type": req.Header.Get("Content-Type"),
		"sessiontype": req.Header.Get("X-sap-adt-sessiontype"), "body": string(body)})
	headers := make(http.Header)
	headers.Set("X-CSRF-Token", "offline-fixture-token")
	if req.Method == "HEAD" {
		return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	}
	want, err := url.Parse(c.row.URL)
	if err != nil || req.Method != c.row.Method || !strings.EqualFold(req.URL.EscapedPath(), want.EscapedPath()) {
		return nil, fmt.Errorf("offline fixture refuses unexpected operation %s %s", req.Method, req.URL.EscapedPath())
	}
	c.used = true
	if typ, ok := c.row.Response.Headers["content-type"].(string); ok {
		headers.Set("Content-Type", typ)
	}
	return &http.Response{StatusCode: c.row.Response.Status, Header: headers, Body: io.NopCloser(bytes.NewReader(c.body)), Request: req}, nil
}

func decode(p part) ([]byte, error) {
	if p.Body.Truncated {
		return nil, fmt.Errorf("truncated")
	}
	b, err := base64.StdEncoding.DecodeString(p.Body.Base64)
	if err != nil {
		return nil, err
	}
	enc, _ := p.Headers["content-encoding"].(string)
	if enc == "gzip" {
		r, err := gzip.NewReader(bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		defer r.Close()
		return io.ReadAll(r)
	}
	if enc != "" && enc != "identity" {
		return nil, fmt.Errorf("unsupported encoding %s", enc)
	}
	return b, nil
}

func run(row exchange) (map[string]interface{}, bool) {
	u, err := url.Parse(row.URL)
	if err != nil {
		return nil, false
	}
	p := u.Path
	operation := ""
	switch {
	case row.Method == "GET" && p == "/sap/bc/adt/repository/informationsystem/search":
		operation = "SearchObjectByType"
	case row.Method == "POST" && p == "/sap/bc/adt/repository/nodestructure":
		operation = "GetPackage"
	case row.Method == "GET" && strings.Contains(p, "/oo/classes/") && strings.HasSuffix(p, "/objectstructure"):
		operation = "GetClassObjectStructure"
	case row.Method == "GET" && strings.Contains(p, "/oo/classes/") && strings.HasSuffix(p, "/source/main") && !strings.Contains(p, "/includes/"):
		operation = "GetClass"
	case row.Method == "GET" && strings.Contains(p, "/programs/programs/") && strings.HasSuffix(p, "/source/main"):
		operation = "GetProgram"
	case row.Method == "GET" && strings.Contains(p, "/oo/interfaces/") && strings.HasSuffix(p, "/source/main"):
		operation = "GetInterface"
	case row.Method == "GET" && strings.Contains(p, "/ddic/ddl/sources/") && strings.HasSuffix(p, "/source/main"):
		operation = "GetDDLS"
	case row.Method == "POST" && p == "/sap/bc/adt/checkruns":
		operation = "SyntaxCheck"
	case row.Method == "POST" && p == "/sap/bc/adt/abapunit/testruns":
		operation = "RunUnitTests"
	case row.Method == "POST" && p == "/sap/bc/adt/activation":
		operation = "Activate"
	default:
		return nil, false
	}
	result := map[string]interface{}{"operation": operation, "status": "not-run"}
	b, err := decode(row.Response)
	if err != nil {
		result["error"] = err.Error()
		return result, true
	}
	fake := &consumer{row: row, body: b}
	cfg := adt.NewConfig("https://offline.invalid", "fixture", "fixture")
	client := adt.NewClientWithTransport(cfg, adt.NewTransportWithClient(cfg, fake))
	ctx := context.Background()
	name := strings.TrimSuffix(strings.TrimSuffix(u.EscapedPath(), "/source/main"), "/objectstructure")
	name = name[strings.LastIndex(name, "/")+1:]
	name, _ = url.PathUnescape(name)
	var value interface{}
	switch operation {
	case "SearchObjectByType":
		value, err = client.SearchObjectByType(ctx, u.Query().Get("query"), u.Query().Get("objectType"), 100)
	case "GetPackage":
		value, err = client.GetPackage(ctx, "FIXTURE")
	case "GetClassObjectStructure":
		value, err = client.GetClassObjectStructure(ctx, name)
	case "GetClass":
		value, err = client.GetClass(ctx, name)
	case "GetProgram":
		value, err = client.GetProgram(ctx, name)
	case "GetInterface":
		value, err = client.GetInterface(ctx, name)
	case "GetDDLS":
		value, err = client.GetDDLS(ctx, name)
	case "SyntaxCheck":
		value, err = client.SyntaxCheck(ctx, "/sap/bc/adt/programs/programs/FIXTURE", "REPORT fixture.")
	case "RunUnitTests":
		value, err = client.RunUnitTests(ctx, "/sap/bc/adt/oo/classes/FIXTURE", nil)
	case "Activate":
		value, err = client.Activate(ctx, "/sap/bc/adt/programs/programs/FIXTURE", "FIXTURE")
	}
	result["requests"] = fake.requests
	result["consumed"] = fake.used
	result["note"] = "Response-consumer probe only. HEAD token is synthetic; request parameters/body may differ; no session replay or live OSD test."
	if err != nil {
		result["status"] = "client-error"
		result["error"] = err.Error()
	} else {
		result["status"] = "decoded-not-semantic-proof"
		result["value"] = value
	}
	return result, true
}

func main() {
	out := flag.String("out", "", "private JSON report path (required)")
	selfTest := flag.Bool("self-test", false, "exercise rejection and successful decoding without capture files")
	flag.Parse()
	if *selfTest {
		row := exchange{Method: "GET", URL: "/sap/bc/adt/repository/informationsystem/search"}
		row.Response.Status = 200
		row.Response.Headers = map[string]interface{}{"content-type": "application/xml"}
		row.Response.Body.Base64 = base64.StdEncoding.EncodeToString([]byte("<broken>"))
		bad, ok := run(row)
		if !ok || bad["status"] != "client-error" {
			panic("malformed XML was not rejected")
		}
		row.Response.Body.Base64 = base64.StdEncoding.EncodeToString([]byte(`<objectReferences><objectReference name="DEMO" type="CLAS/OC" uri="/sap/bc/adt/oo/classes/demo"/></objectReferences>`))
		good, ok := run(row)
		if !ok || good["status"] != "decoded-not-semantic-proof" || len(good["value"].([]adt.SearchResult)) != 1 {
			panic("nonempty search response was not retained")
		}
		fake := &consumer{row: row}
		req, _ := http.NewRequest("GET", "https://offline.invalid/unexpected", nil)
		if _, err := fake.Do(req); err == nil {
			panic("unexpected resource accepted")
		}
		fmt.Println("VSP consumer self-test: malformed XML rejected, one search object retained, unexpected request refused")
		return
	}
	if *out == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "--out and capture files required")
		os.Exit(2)
	}
	results := []map[string]interface{}{}
	for _, path := range flag.Args() {
		path, err := filepath.Abs(path)
		if err != nil {
			panic(err)
		}
		f, err := os.Open(path)
		if err != nil {
			panic(err)
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 4096), 32*1024*1024)
		line := 0
		for scanner.Scan() {
			line++
			var row exchange
			if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
				panic(fmt.Errorf("%s:%d: %w", path, line, err))
			}
			if row.Response.Status != 200 {
				continue
			}
			if result, ok := run(row); ok {
				result["ref"] = fmt.Sprintf("%s:%d", path, line)
				results = append(results, result)
			}
		}
		if err := scanner.Err(); err != nil {
			panic(err)
		}
		f.Close()
	}
	b, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(*out, append(b, '\n'), 0600); err != nil {
		panic(err)
	}
	fmt.Printf("%d captured responses tested through VSP; report: %s\n", len(results), *out)
}
