package abap

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SMW0, the MIME objects of the Web Repository, for the Go host.
//
// On a system the bytes are rows of WWWDATA; in the transpiler runtime
// WWWDATA_IMPORT reads the file the transpiler wrote beside the module, or
// asks abap.W3MI_LOADER(objid, filename) when a host installed one (the
// browser preview). Here the host is this package: the build copies every
// object's data file into a media directory beside the binary, with an index
// w3mi.json that maps the object id (wwwdata-objid, as the object's XML names
// it) to the file (tools/gogen/media.mjs writes both), and the binary is
// told where that directory is (SetMediaDir, a flag of the host).
//
// The rows a system hands out, measured on A4H 2026-09-23
// (ZCL_GOGEN_T_W3MI, pinned in semantics.mjs):
//   - an object that does not exist is IMPORT_ERROR and the MIME table is
//     left as it was (open-abap-core clears it first);
//   - a RELID other than MI is WRONG_OBJECT_TYPE;
//   - a hit replaces the table's rows with x(255) rows, the last padded 00.

// W3MIEntry is one object of the index.
type W3MIEntry struct {
	File string `json:"file"`
	Size int    `json:"size"`
}

var (
	mediaMu    sync.Mutex
	mediaDir   string
	mediaIndex map[string]W3MIEntry
	mediaCache = map[string][]byte{}
)

// SetMediaDir points the host at a media directory and reads its index.
// An empty dir means no media: every import is IMPORT_ERROR.
func SetMediaDir(dir string) error {
	mediaMu.Lock()
	defer mediaMu.Unlock()
	mediaDir, mediaIndex, mediaCache = dir, map[string]W3MIEntry{}, map[string][]byte{}
	if dir == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, "w3mi.json"))
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, &mediaIndex)
}

// W3MIObjects is the index, for a host that lists what it serves.
func W3MIObjects() map[string]W3MIEntry {
	mediaMu.Lock()
	defer mediaMu.Unlock()
	out := make(map[string]W3MIEntry, len(mediaIndex))
	for k, v := range mediaIndex {
		out[k] = v
	}
	return out
}

// W3MIBytes is the content of object objid; false when there is none. The
// bytes are read once and kept, since a page asks for the same picture
// again and again; they must not be written to.
func W3MIBytes(objid string) ([]byte, bool) {
	mediaMu.Lock()
	defer mediaMu.Unlock()
	// the key as given, trailing blanks off (a CHAR field): WWWDATA compares
	// it as stored, and the index keys are the objects' NAMEs, upper case as
	// SMW0 stores them, so a lower-case OBJID is a miss, not a guess
	id := strings.TrimRight(objid, " ")
	e, ok := mediaIndex[id]
	if !ok {
		return nil, false
	}
	if b, ok := mediaCache[id]; ok {
		return b, true
	}
	// the index names a file inside the directory, never a path out of it
	if e.File != filepath.Base(e.File) {
		return nil, false
	}
	b, err := os.ReadFile(filepath.Join(mediaDir, e.File))
	if err != nil {
		return nil, false
	}
	mediaCache[id] = b
	return b, true
}

func fmArg(args map[string]Data, name string) (Data, bool) {
	d, ok := args[name]
	return d, ok && d.P != nil
}

// WWWDATA_IMPORT: KEY (a WWWDATATAB) in, the content as rows of MIME out.
func WWWDATA_IMPORT(s *Session, args map[string]Data) {
	key, ok := fmArg(args, "KEY")
	if !ok {
		panic(NotCompiled("WWWDATA_IMPORT", "KEY not supplied"))
	}
	relid, _ := Component(key, "RELID")
	objid, _ := Component(key, "OBJID")
	if relid.P == nil || objid.P == nil {
		panic(NotCompiled("WWWDATA_IMPORT", "KEY is not a WWWDATATAB"))
	}
	if strings.TrimRight(DataString(relid), " ") != "MI" {
		panic(ClassicException{Name: "WRONG_OBJECT_TYPE", Method: "WWWDATA_IMPORT"})
	}
	b, found := W3MIBytes(DataString(objid))
	if !found {
		panic(ClassicException{Name: "IMPORT_ERROR", Method: "WWWDATA_IMPORT"})
	}
	// MIME is OPTIONAL in the signature (TABLES MIME STRUCTURE W3MIME
	// OPTIONAL), so a call without it is an existence check and legal
	mime, ok := fmArg(args, "MIME")
	if !ok {
		return
	}
	writeRows(mime, b, "WWWDATA_IMPORT")
}

// writeRows replaces the rows of a binary table with the bytes, row by row
// of the row's width (an x field or a structure whose first component is
// one), the last row padded with 00.
func writeRows(tab Data, b []byte, who string) {
	if tab.T.Kind != 'h' || tab.T.Append == nil {
		panic(NotCompiled(who, "a binary table that is not a standard table"))
	}
	line := func(row Data) Data {
		if row.T.Kind == 'X' {
			return row
		}
		if (row.T.Kind == 'u' || row.T.Kind == 'v') && len(row.T.Comps) > 0 && row.T.Comps[0].T.Kind == 'X' {
			return Data{P: row.T.Comps[0].Get(row.P), T: row.T.Comps[0].T}
		}
		panic(NotCompiled(who, "a binary table whose row is not an x field"))
	}
	width := tab.T.Row.Len
	if tab.T.Row.Kind != 'X' && len(tab.T.Row.Comps) > 0 {
		width = tab.T.Row.Comps[0].T.Len
	}
	if width <= 0 {
		panic(NotCompiled(who, "a binary table row of no width"))
	}
	tab.T.Zero(tab.P)
	for off := 0; off < len(b); off += width {
		end := min(off+width, len(b))
		row := Data{P: tab.T.Append(tab.P), T: tab.T.Row}
		*line(row).P.(*string) = XFit(string(b[off:end]), width)
	}
}

// SCMS_BINARY_TO_XSTRING: the rows of BINARY_TAB joined, cut to
// INPUT_LENGTH, into BUFFER. A4H 2026-09-23: INPUT_LENGTH 0 or negative is
// an empty buffer, one beyond the rows is all of them, an empty table an
// empty buffer. FIRST_LINE / LAST_LINE are not measured and are refused
// when they are not 0.
func SCMS_BINARY_TO_XSTRING(s *Session, args map[string]Data) {
	for _, p := range []string{"FIRST_LINE", "LAST_LINE"} {
		if d, ok := fmArg(args, p); ok && DataI(d) != 0 {
			panic(NotCompiled("SCMS_BINARY_TO_XSTRING", p+" is not measured"))
		}
	}
	// INPUT_LENGTH and BINARY_TAB are obligatory: a call without either is
	// a syntax error on a system, so it is refused rather than defaulted
	d, ok := fmArg(args, "INPUT_LENGTH")
	if !ok {
		panic(NotCompiled("SCMS_BINARY_TO_XSTRING", "INPUT_LENGTH not supplied"))
	}
	n := DataI(d)
	var all strings.Builder
	tab, ok := fmArg(args, "BINARY_TAB")
	if !ok {
		panic(NotCompiled("SCMS_BINARY_TO_XSTRING", "BINARY_TAB not supplied"))
	}
	{
		if tab.T.Kind != 'h' {
			panic(NotCompiled("SCMS_BINARY_TO_XSTRING", "BINARY_TAB is not a table"))
		}
		for i := 0; i < tab.T.Lines(tab.P); i++ {
			row := Row(tab, i)
			if (row.T.Kind == 'u' || row.T.Kind == 'v') && len(row.T.Comps) > 0 {
				row = Data{P: row.T.Comps[0].Get(row.P), T: row.T.Comps[0].T}
			}
			if row.T.Kind != 'X' {
				panic(NotCompiled("SCMS_BINARY_TO_XSTRING", "a row that is not an x field"))
			}
			all.WriteString(*row.P.(*string))
		}
	}
	out := all.String()
	if n <= 0 {
		out = ""
	} else if int(n) < len(out) {
		out = out[:n]
	}
	buf, ok := fmArg(args, "BUFFER")
	if !ok {
		return
	}
	if buf.T.Kind != 'y' {
		panic(NotCompiled("SCMS_BINARY_TO_XSTRING", "BUFFER into a "+string(buf.T.Kind)))
	}
	*buf.P.(*string) = out
}
