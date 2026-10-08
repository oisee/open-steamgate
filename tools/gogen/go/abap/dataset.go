package abap

import (
	"errors"
	"io"
	"osg/gogen/sandbox"
	"strings"
	"sync"
)

// OPEN / READ / TRANSFER / CLOSE / DELETE / GET / SET DATASET, as the
// transpiler's runtime does them (packages/runtime/src/statements/dataset.ts
// on the pinned oisee/transpiler; docs/dataset.md lists every case measured
// on A4H). The ABAP semantics are here; the disk is a DatasetHost, which
// opens a name and reads and writes bytes at a position.
//
// The host is the sandbox of tools/osd-dataset.mjs, over the same
// variables: nothing is reachable unless OSD_DATASET_READ / OSD_DATASET_WRITE
// name a root, every name is resolved to its real path and compared with the
// roots' real paths as directories, a refusal is sy-subrc 8 with the reason
// in MESSAGE, and OSD_DATASET_AUDIT gets one JSON line per OPEN and DELETE.

// The modes, the handle and the host are the sandbox package's
// (tools/gogen/go/sandbox), named here as the statements have always
// named them.
type DatasetMode = sandbox.Mode

const (
	DatasetInput     = sandbox.Input
	DatasetOutput    = sandbox.Output
	DatasetAppending = sandbox.Appending
	DatasetUpdate    = sandbox.Update
)

// DatasetHandle is an open file; the runtime keeps the position.
type DatasetHandle = sandbox.Handle

// DatasetHost opens by name; a refusal or failure is the MESSAGE text and
// becomes sy-subrc 8. Delete is false when there was nothing to delete.
type DatasetHost = sandbox.Host

// Sandbox is the disk behind the roots (go/sandbox).
type Sandbox = sandbox.Sandbox

// SandboxFromEnv is the sandbox of the OSD_DATASET_* variables.
func SandboxFromEnv() *Sandbox { return sandbox.FromEnv() }

// DatasetOpen is what OPEN DATASET says besides the name.
type DatasetOpen struct {
	Mode     DatasetMode
	Binary   bool
	Message  *Data  // MESSAGE, nil when absent
	Position *int64 // AT POSITION, nil when absent
}

type openDataset struct {
	h      DatasetHandle
	mode   DatasetMode
	binary bool
	pos    int64
}

// the host every session uses; nil means the sandbox over the environment,
// made on first use
var (
	datasetHostMu sync.Mutex
	datasetHost   DatasetHost
	datasetFiles  sync.Map // *Session -> map[string]*openDataset
)

// SetDatasetHost installs a host (tests, an embedding program); nil goes back
// to the sandbox over the environment.
func SetDatasetHost(h DatasetHost) {
	datasetHostMu.Lock()
	defer datasetHostMu.Unlock()
	datasetHost = h
}

func currentDatasetHost() DatasetHost {
	datasetHostMu.Lock()
	defer datasetHostMu.Unlock()
	if datasetHost == nil {
		datasetHost = SandboxFromEnv()
	}
	return datasetHost
}

func filesOf(s *Session) map[string]*openDataset {
	if m, ok := datasetFiles.Load(s); ok {
		return m.(map[string]*openDataset)
	}
	m, _ := datasetFiles.LoadOrStore(s, map[string]*openDataset{})
	return m.(map[string]*openDataset)
}

// CloseSessionDatasets releases every handle owned by an ended internal session.
func CloseSessionDatasets(s *Session) {
	if m, ok := datasetFiles.LoadAndDelete(s); ok {
		for _, f := range m.(map[string]*openDataset) {
			f.h.Close()
		}
	}
}

func datasetName(name string) string { return strings.TrimRight(name, " ") }

func fileOpenMode(stmt string) {
	panic(ArithmeticError{Class: "CX_SY_FILE_OPEN_MODE", Op: stmt})
}

func opened(s *Session, name, stmt string) *openDataset {
	f := filesOf(s)[datasetName(name)]
	if f == nil {
		fileOpenMode(stmt)
	}
	return f
}

// OpenDataset is OPEN DATASET name FOR mode IN BINARY|TEXT MODE.
func OpenDataset(s *Session, name string, o DatasetOpen) {
	name = datasetName(name)
	files := filesOf(s)
	if files[name] != nil {
		panic(ArithmeticError{Class: "CX_SY_FILE_OPEN", Op: "OPEN DATASET"})
	}
	h, message := currentDatasetHost().Open(name, o.Mode)
	if h == nil {
		if o.Message != nil {
			msg := message
			MoveData(*o.Message, Data{P: &msg, T: TString})
		}
		s.Sy.Subrc = 8
		return
	}
	f := &openDataset{h: h, mode: o.Mode, binary: o.Binary}
	if o.Mode == DatasetAppending {
		if n, err := h.Size(); err == nil {
			f.pos = n
		}
	}
	if o.Position != nil {
		f.pos = *o.Position
	}
	files[name] = f
	s.Sy.Subrc = 0
}

// CloseDataset: closing a file that is not open is no error (measured).
func CloseDataset(s *Session, name string) {
	name = datasetName(name)
	files := filesOf(s)
	if f := files[name]; f != nil {
		delete(files, name)
		f.h.Close()
	}
	s.Sy.Subrc = 0
}

// DeleteDataset: 4 when nothing was deleted; an open file is closed first
// (measured: a READ after it raises CX_SY_FILE_OPEN_MODE).
func DeleteDataset(s *Session, name string) {
	name = datasetName(name)
	files := filesOf(s)
	if f := files[name]; f != nil {
		delete(files, name)
		f.h.Close()
	}
	if currentDatasetHost().Delete(name) {
		s.Sy.Subrc = 0
	} else {
		s.Sy.Subrc = 4
	}
}

func isByteLike(k byte) bool { return k == 'X' || k == 'y' }
func isCharLike(k byte) bool {
	return k == 'C' || k == 'g' || k == 'N' || k == 'D' || k == 'T'
}

// the characters of a character-like field; a C field at its full length
// when padded is true
func charsOf(d Data, padded bool) string {
	v := *d.P.(*string)
	if d.T.Kind == 'C' {
		v = strings.TrimRight(v, " ")
		if padded && int(Strlen(v)) < d.T.Len {
			v += strings.Repeat(" ", d.T.Len-int(Strlen(v)))
		}
	}
	return v
}

func utf16le(s string) []byte {
	units := UTF16Units(s)
	out := make([]byte, 2*len(units))
	for i, u := range units {
		out[2*i], out[2*i+1] = byte(u), byte(u>>8)
	}
	return out
}

func fromUTF16LE(b []byte) string {
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return UTF16String(units)
}

// Transfer is TRANSFER src TO name [LENGTH length] [NO END OF LINE]; length
// is -1 when absent.
func Transfer(s *Session, src Data, name string, length int, noEndOfLine bool) {
	f := opened(s, name, "TRANSFER")
	if f.mode == DatasetInput {
		fileOpenMode("TRANSFER")
	}
	var b []byte
	k := src.T.Kind
	if f.binary {
		switch {
		case isByteLike(k):
			b = []byte(*src.P.(*string))
			if length >= 0 {
				if len(b) >= length {
					b = b[:length]
				} else {
					b = append(b, make([]byte, length-len(b))...)
				}
			}
		case isCharLike(k):
			// UTF-16LE, a C field at its full length (measured)
			text := charsOf(src, true)
			if length >= 0 {
				r := UTF16Units(text)
				if len(r) > length {
					r = r[:length]
				}
				text = UTF16String(r) + strings.Repeat(" ", length-len(r))
			}
			b = utf16le(text)
		default:
			panic(NotCompiled("TRANSFER", "BINARY MODE supports byte-like and character-like fields only"))
		}
	} else {
		if !isCharLike(k) {
			panic(NotCompiled("TRANSFER", "TEXT MODE is only supported for character-type data objects"))
		}
		var text string
		if length >= 0 {
			r := UTF16Units(charsOf(src, true))
			if len(r) > length {
				r = r[:length]
			}
			text = UTF16String(r)
		} else {
			// a C field loses its trailing blanks, a string keeps them (measured)
			text = charsOf(src, false)
		}
		if !noEndOfLine {
			text += "\n"
		}
		b = []byte(text)
	}
	if err := f.h.WriteAt(f.pos, b); err != nil {
		panic(err)
	}
	f.pos += int64(len(b))
	s.Sy.Subrc = 0
}

// the text mode's read size while it looks for the end of a line
const datasetChunk = 64 * 1024

// ReadDataset is READ DATASET name INTO target [MAXIMUM LENGTH max] [ACTUAL
// LENGTH actual]; max is -1 when absent, actual nil.
func ReadDataset(s *Session, name string, target Data, max int, actual *Data) {
	f := opened(s, name, "READ DATASET")
	setActual := func(n int) {
		if actual != nil {
			v := int32(n)
			MoveData(*actual, Data{P: &v, T: TI})
		}
	}
	// a file opened for writing only answers 4 (measured, OUTPUT and APPENDING)
	if f.mode == DatasetOutput || f.mode == DatasetAppending {
		setActual(0)
		s.Sy.Subrc = 4
		return
	}
	if !f.binary {
		readDatasetLine(s, f, target, max, setActual)
	} else {
		readDatasetBytes(s, f, target, max, setActual)
	}
}

// TEXT MODE: a line per READ without its LF (a CR stays), the last needs no
// LF, then sy-subrc 4 and the target cleared; ACTUAL LENGTH is the whole
// line and the whole line is consumed (measured)
func readDatasetLine(s *Session, f *openDataset, target Data, max int, setActual func(int)) {
	if !isCharLike(target.T.Kind) {
		panic(NotCompiled("READ DATASET", "the current statement is only supported for character-type data objects"))
	}
	if max >= 0 {
		panic(NotCompiled("READ DATASET", "MAXIMUM LENGTH in TEXT MODE"))
	}
	var line []byte
	pos := f.pos
	ended := false
	for {
		chunk, err := f.h.ReadAt(pos, datasetChunk)
		if err != nil && !errors.Is(err, io.EOF) {
			panic(err)
		}
		if len(chunk) == 0 {
			break
		}
		if i := indexByte(chunk, '\n'); i >= 0 {
			line = append(line, chunk[:i]...)
			pos += int64(i + 1)
			ended = true
			break
		}
		line = append(line, chunk...)
		pos += int64(len(chunk))
	}
	if !ended && len(line) == 0 {
		ClearData(target)
		setActual(0)
		s.Sy.Subrc = 4
		return
	}
	f.pos = pos
	text := string(line)
	MoveData(target, Data{P: &text, T: TString})
	setActual(int(Strlen(text)))
	s.Sy.Subrc = 0
}

func indexByte(b []byte, c byte) int {
	for i, x := range b {
		if x == c {
			return i
		}
	}
	return -1
}

// BINARY MODE: a fixed field takes its length in bytes (a C field two per
// character, UTF-16LE), a string or xstring the rest; MAXIMUM LENGTH caps;
// fewer bytes than asked is sy-subrc 4, ACTUAL LENGTH counts bytes (measured)
func readDatasetBytes(s *Session, f *openDataset, target Data, max int, setActual func(int)) {
	k := target.T.Kind
	variable := k == 'y' || k == 'g'
	var want int
	switch {
	case k == 'X':
		want = target.T.Len
	case k == 'y' || k == 'g':
		size, err := f.h.Size()
		if err != nil {
			panic(err)
		}
		want = int(size - f.pos)
		if want < 0 {
			want = 0
		}
	case isCharLike(k):
		want = target.T.Len * 2
	default:
		panic(NotCompiled("READ DATASET", "BINARY MODE supports byte-like and character-like fields only"))
	}
	if max >= 0 && max < want {
		want = max
	}
	var b []byte
	if want > 0 {
		var err error
		b, err = f.h.ReadAt(f.pos, want)
		if err != nil && !errors.Is(err, io.EOF) {
			panic(err)
		}
	}
	f.pos += int64(len(b))
	switch {
	case k == 'X':
		v := string(b) + strings.Repeat("\x00", target.T.Len-len(b))
		*target.P.(*string) = v
	case k == 'y':
		v := string(b)
		*target.P.(*string) = v
	default:
		text := fromUTF16LE(b)
		MoveData(target, Data{P: &text, T: TString})
	}
	setActual(len(b))
	if variable {
		if len(b) > 0 {
			s.Sy.Subrc = 0
		} else {
			s.Sy.Subrc = 4
		}
	} else if len(b) < want || want == 0 {
		s.Sy.Subrc = 4
	} else {
		s.Sy.Subrc = 0
	}
}

// GetDatasetPosition is GET DATASET name POSITION pos.
func GetDatasetPosition(s *Session, name string, pos Data) {
	f := opened(s, name, "GET DATASET")
	switch pos.T.Kind {
	case '8':
		*pos.P.(*int64) = f.pos
	case 'I':
		if f.pos > 1<<31-1 {
			panic(ArithmeticError{Class: "CX_SY_CONVERSION_OVERFLOW", Op: "GET DATASET POSITION"})
		}
		*pos.P.(*int32) = int32(f.pos)
	default:
		v := f.pos
		MoveData(pos, Data{P: &v, T: TInt8})
	}
	s.Sy.Subrc = 0
}

// SetDatasetPosition is SET DATASET name POSITION pos | END OF FILE.
func SetDatasetPosition(s *Session, name string, pos int64, endOfFile bool) {
	f := opened(s, name, "SET DATASET")
	if endOfFile {
		n, err := f.h.Size()
		if err != nil {
			panic(err)
		}
		f.pos = n
	} else {
		f.pos = pos
	}
	s.Sy.Subrc = 0
}
