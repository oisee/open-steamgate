package abap

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
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

type DatasetMode string

const (
	DatasetInput     DatasetMode = "INPUT"
	DatasetOutput    DatasetMode = "OUTPUT"
	DatasetAppending DatasetMode = "APPENDING"
	DatasetUpdate    DatasetMode = "UPDATE"
)

// DatasetHandle is an open file; the runtime keeps the position.
type DatasetHandle interface {
	// ReadAt answers up to n bytes from pos, fewer only at the end.
	ReadAt(pos int64, n int) ([]byte, error)
	WriteAt(pos int64, b []byte) error
	Size() (int64, error)
	Close() error
}

// DatasetHost opens by name; a refusal or failure is the MESSAGE text and
// becomes sy-subrc 8. Delete is false when there was nothing to delete.
type DatasetHost interface {
	Open(name string, mode DatasetMode) (DatasetHandle, string)
	Delete(name string) bool
}

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
		if padded && len([]rune(v)) < d.T.Len {
			v += strings.Repeat(" ", d.T.Len-len([]rune(v)))
		}
	}
	return v
}

func utf16le(s string) []byte {
	units := utf16.Encode([]rune(s))
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
	return string(utf16.Decode(units))
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
				r := []rune(text)
				if len(r) > length {
					r = r[:length]
				}
				text = string(r) + strings.Repeat(" ", length-len(r))
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
			r := []rune(charsOf(src, true))
			if len(r) > length {
				r = r[:length]
			}
			text = string(r)
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
	setActual(len(utf16.Encode([]rune(text))))
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

// ---- the sandbox ----

// Sandbox is the disk behind roots; a write root is readable too. Home
// resolves a relative name (default the first write root, else the first
// read root). Audit, when set, gets every OPEN and DELETE.
type Sandbox struct {
	Read, Write             []string
	Home                    string
	Audit                   func(entry map[string]any)
	CreatePerm              os.FileMode
	once                    sync.Once
	read, write, browseRead []string
	// one os.Root per real root: every open and unlink goes through the
	// root that holds the path, so the kernel resolves it beneath that
	// directory in the same call that creates or opens the file. A parent
	// swapped for a symlink between the path checks and the open cannot
	// take a create outside (openat per component with O_NOFOLLOW on
	// Linux, O_NOFOLLOW_ANY on Windows); the path checks stay for the
	// refusal messages and the audit
	handles map[string]*os.Root
}

// Close releases the root descriptors owned by a command or dialog.
func (sb *Sandbox) Close() error {
	sb.roots()
	var first error
	for _, root := range sb.handles {
		if err := root.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// SandboxFromEnv is the sandbox of OSD_DATASET_READ / OSD_DATASET_WRITE /
// OSD_DATASET_HOME / OSD_DATASET_AUDIT, the variables tools/osd-dataset.mjs
// reads; with neither root set it refuses everything.
func SandboxFromEnv() *Sandbox {
	roots := func(v string) []string {
		var out []string
		for _, r := range filepath.SplitList(v) {
			if r = strings.TrimSpace(r); r != "" {
				out = append(out, r)
			}
		}
		return out
	}
	sb := &Sandbox{Read: roots(os.Getenv("OSD_DATASET_READ")), Write: roots(os.Getenv("OSD_DATASET_WRITE")), Home: os.Getenv("OSD_DATASET_HOME")}
	if file := os.Getenv("OSD_DATASET_AUDIT"); file != "" {
		// Audit output has the same write boundary as report output. Use a
		// separate host so recording an audit entry does not audit itself.
		auditHost := &Sandbox{Write: sb.Write, Home: sb.Home, CreatePerm: 0o600}
		sb.Audit = func(entry map[string]any) {
			line, err := json.Marshal(entry)
			if err != nil {
				return
			}
			line = append(line, '\n')
			if f, _ := auditHost.Open(file, DatasetAppending); f != nil {
				if n, err := f.Size(); err == nil {
					_ = f.WriteAt(n, line)
				}
				_ = f.Close()
			}
		}
	}
	return sb
}

func (sb *Sandbox) roots() ([]string, []string) {
	sb.once.Do(func() {
		real := func(r string) string {
			abs, err := filepath.Abs(r)
			if err != nil {
				return ""
			}
			p, err := filepath.EvalSymlinks(abs)
			if err != nil {
				return ""
			}
			return p
		}
		for _, r := range sb.Read {
			if p := real(r); p != "" {
				sb.browseRead = append(sb.browseRead, p)
			}
		}
		for _, r := range append(append([]string{}, sb.Read...), sb.Write...) {
			if p := real(r); p != "" {
				sb.read = append(sb.read, p)
			}
		}
		for _, r := range sb.Write {
			if p := real(r); p != "" {
				sb.write = append(sb.write, p)
			}
		}
		sb.handles = map[string]*os.Root{}
		for _, p := range sb.read {
			if _, ok := sb.handles[p]; ok {
				continue
			}
			if h, err := os.OpenRoot(p); err == nil {
				sb.handles[p] = h
			}
		}
	})
	return sb.read, sb.write
}

// BrowseRoots returns the normalized roots granted to a file dialog.
// DATASET itself can read write roots, but open/directory dialogs require
// explicit read grants.
func (sb *Sandbox) BrowseRoots(save bool) []string {
	_, write := sb.roots()
	if save {
		return append([]string(nil), write...)
	}
	return append([]string(nil), sb.browseRead...)
}

// BrowsePath checks a candidate with DATASET's lexical and real-path rules.
// Directories are opened through the same os.Root handle used by DATASET, so
// a symlink swapped between checking and listing cannot escape the root.
func (sb *Sandbox) BrowsePath(name string, save bool) (string, *os.File, error) {
	_, write := sb.roots()
	roots, given := sb.browseRead, sb.Read
	if save {
		roots, given = write, sb.Write
	}
	real, _, refused, missing := sb.place(name, roots, given)
	if refused != "" {
		return "", nil, errors.New(refused)
	}
	if missing {
		return "", nil, os.ErrNotExist
	}
	root, rel, ok := sb.beneath(real, roots)
	if !ok {
		return "", nil, os.ErrPermission
	}
	f, err := openBrowseDirectory(root, rel)
	return real, f, err
}

// BrowseEntry inspects a directory entry without opening it. In particular,
// opening a FIFO here would wait for a writer while the terminal is raw.
func (sb *Sandbox) BrowseEntry(name string, save bool) (string, os.FileInfo, error) {
	_, write := sb.roots()
	roots, given := sb.browseRead, sb.Read
	if save {
		roots, given = write, sb.Write
	}
	real, _, refused, missing := sb.place(name, roots, given)
	if refused != "" {
		return "", nil, errors.New(refused)
	}
	if missing {
		return "", nil, os.ErrNotExist
	}
	root, rel, ok := sb.beneath(real, roots)
	if !ok {
		return "", nil, os.ErrPermission
	}
	info, err := root.Stat(rel)
	return real, info, err
}

// BrowseSaveName validates a future file without creating or truncating it.
func (sb *Sandbox) BrowseSaveName(name string) (string, error) {
	_, write := sb.roots()
	real, _, refused, missing := sb.place(name, write, sb.Write)
	if refused != "" {
		return "", errors.New(refused)
	}
	if missing {
		return "", os.ErrNotExist
	}
	// An existing symlink can be swapped into the target after a directory
	// listing. Do not return it as a save name, even when its parent is safe.
	root, rel, ok := sb.beneath(real, write)
	if !ok {
		return "", os.ErrPermission
	}
	if info, err := root.Lstat(rel); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", os.ErrPermission
	}
	if _, info, err := sb.BrowseEntry(real, true); err == nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("not a regular file")
		}
	}
	// Recheck the parent with the root handle before returning the name.
	_, f, err := sb.BrowsePath(filepath.Dir(real), true)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return real, nil
}

// BrowseSaveExists checks the final component through the write root without
// following a symlink. It is for an overwrite prompt, not authorization to
// write; the caller must still validate the name again after confirmation.
func (sb *Sandbox) BrowseSaveExists(name string) (bool, error) {
	_, write := sb.roots()
	// name is the path returned by BrowseSaveName. Use it lexically here:
	// resolving it again would follow a final symlink swapped in while the
	// user was deciding whether to overwrite.
	if !filepath.IsAbs(name) || !within(filepath.Clean(name), write) {
		return false, os.ErrPermission
	}
	root, rel, ok := sb.beneath(filepath.Clean(name), write)
	if !ok {
		return false, os.ErrPermission
	}
	info, err := root.Lstat(rel)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
		return false, os.ErrPermission
	}
	return true, nil
}

func (sb *Sandbox) note(entry map[string]any) {
	if sb.Audit != nil {
		entry["at"] = time.Now().UTC().Format(time.RFC3339Nano)
		sb.Audit(entry)
	}
}

func within(candidate string, roots []string) bool {
	for _, root := range roots {
		if candidate == root || strings.HasPrefix(candidate, strings.TrimSuffix(root, string(filepath.Separator))+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// place is the real path of name when it lies inside one of roots (their
// real paths; given are the roots as configured). Three checks, as in
// tools/osd-dataset.mjs: the name as written is inside a root before the
// disk is asked anything, so a refusal tells nothing about directories
// elsewhere; the path with its symlinks followed is inside a root; a last
// component that is a symlink pointing nowhere is refused, since opening it
// for writing would create the file at its target.
func (sb *Sandbox) place(name string, roots, given []string) (real, named, refused string, missing bool) {
	if len(roots) == 0 {
		return "", "", "no dataset root allows this (OSD_DATASET_READ / OSD_DATASET_WRITE)", false
	}
	if strings.ContainsRune(name, 0) {
		return "", "", "a NUL in the name", false
	}
	read, write := sb.roots()
	base := sb.Home
	if base == "" {
		if len(write) > 0 {
			base = write[0]
		} else if len(read) > 0 {
			base = read[0]
		}
	}
	wanted := name
	if !filepath.IsAbs(wanted) {
		wanted = filepath.Join(base, wanted)
	}
	wanted, _ = filepath.Abs(wanted)
	lexical := make([]string, 0, len(given))
	for _, g := range given {
		if a, err := filepath.Abs(g); err == nil {
			lexical = append(lexical, a)
		}
	}
	if !within(wanted, lexical) && !within(wanted, roots) {
		return "", "", name + " is outside the dataset roots", false
	}
	// the entry the name stands for without following its last component:
	// what a DELETE removes (unlink never follows it)
	if dir, err := filepath.EvalSymlinks(filepath.Dir(wanted)); err == nil {
		named = filepath.Join(dir, filepath.Base(wanted))
	}
	if p, err := filepath.EvalSymlinks(wanted); err == nil {
		real = p
	} else {
		if info, err := os.Lstat(wanted); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", "", name + " is a symbolic link that points nowhere", false
		}
		dir, err := filepath.EvalSymlinks(filepath.Dir(wanted))
		if err != nil {
			return "", "", "", true
		}
		real = filepath.Join(dir, filepath.Base(wanted))
	}
	if !within(real, roots) {
		return "", "", name + " is outside the dataset roots", false
	}
	if named == "" {
		named = real
	}
	return real, named, "", false
}

// datasetSwap runs between the path checks and the open or unlink; only
// the tests set it, to stand in for another process at that moment
var datasetSwap func()

// beneath is the os.Root of the outermost of roots that holds path, and
// path relative to it; the outermost, so that a symlink from a nested
// root into the one around it resolves as the path checks allowed it
func (sb *Sandbox) beneath(path string, roots []string) (*os.Root, string, bool) {
	best := ""
	for _, r := range roots {
		if within(path, []string{r}) && sb.handles[r] != nil && (best == "" || len(r) < len(best)) {
			best = r
		}
	}
	if best == "" {
		return nil, "", false
	}
	rel, err := filepath.Rel(best, path)
	if err != nil {
		return nil, "", false
	}
	return sb.handles[best], rel, true
}

// escaped: os.Root refused a path that resolved outside it (the error has
// no exported value)
func escaped(err error) bool {
	return err != nil && strings.Contains(err.Error(), "path escapes from parent")
}

// Open opens name for mode inside the roots.
func (sb *Sandbox) Open(name string, mode DatasetMode) (DatasetHandle, string) {
	read, write := sb.roots()
	roots, given := read, append(append([]string{}, sb.Read...), sb.Write...)
	if mode != DatasetInput {
		roots, given = write, sb.Write
	}
	real, _, refused, missing := sb.place(name, roots, given)
	if refused != "" {
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": false, "why": refused})
		return nil, "Permission denied: " + refused
	}
	if missing {
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": false, "why": "no such directory"})
		return nil, "No such file or directory"
	}
	// no O_APPEND for APPENDING: the runtime starts it at the end and writes
	// at its own position, the same on every platform
	var flags int
	switch mode {
	case DatasetInput:
		flags = os.O_RDONLY
	case DatasetOutput:
		// truncated only after the descriptor is checked below
		flags = os.O_RDWR | os.O_CREATE
	case DatasetAppending:
		flags = os.O_RDWR | os.O_CREATE
	default:
		flags = os.O_RDWR
	}
	if datasetSwap != nil {
		datasetSwap()
	}
	root, rel, ok := sb.beneath(real, roots)
	if !ok {
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": false, "why": "no open root holds it"})
		return nil, "Permission denied: " + name + " is outside the dataset roots"
	}
	perm := sb.CreatePerm
	if perm == 0 {
		perm = 0o644
	}
	fh, err := root.OpenFile(rel, flags, perm)
	if escaped(err) {
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": false, "why": "moved outside the dataset roots while opening"})
		return nil, "Permission denied: " + name + " is outside the dataset roots"
	}
	if err != nil {
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": false, "why": err.Error()})
		// the reason only: an OS message carries the resolved path
		switch {
		case errors.Is(err, os.ErrNotExist):
			return nil, "No such file or directory"
		case isSymlinkLoop(err):
			return nil, "Permission denied: " + name + " is a symbolic link"
		case errors.Is(err, os.ErrPermission):
			return nil, "Permission denied"
		}
		return nil, "error"
	}
	if mode == DatasetOutput {
		if err := fh.Truncate(0); err != nil {
			fh.Close()
			return nil, "error"
		}
	}
	sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(mode), "allowed": true, "path": real})
	if info, err := fh.Stat(); err == nil && info.IsDir() {
		// a directory opens on a system too and then reads nothing
		fh.Close()
		return emptyDataset{}, ""
	}
	return &osDataset{f: fh}, ""
}

// Delete removes name inside a write root.
func (sb *Sandbox) Delete(name string) bool {
	_, write := sb.roots()
	_, named, refused, missing := sb.place(name, write, sb.Write)
	if refused != "" || missing {
		sb.note(map[string]any{"op": "DELETE", "name": name, "allowed": false})
		return false
	}
	if datasetSwap != nil {
		datasetSwap()
	}
	root, rel, ok := sb.beneath(named, write)
	if !ok {
		sb.note(map[string]any{"op": "DELETE", "name": name, "allowed": false})
		return false
	}
	if err := root.Remove(rel); err != nil {
		sb.note(map[string]any{"op": "DELETE", "name": name, "allowed": false, "why": err.Error()})
		return false
	}
	sb.note(map[string]any{"op": "DELETE", "name": name, "allowed": true, "path": named})
	return true
}

type osDataset struct {
	f *os.File
}

func (d *osDataset) ReadAt(pos int64, n int) ([]byte, error) {
	b := make([]byte, n)
	got, err := d.f.ReadAt(b, pos)
	return b[:got], err
}

func (d *osDataset) WriteAt(pos int64, b []byte) error {
	_, err := d.f.WriteAt(b, pos)
	return err
}

func (d *osDataset) Size() (int64, error) {
	info, err := d.f.Stat()
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (d *osDataset) Close() error { return d.f.Close() }

type emptyDataset struct{}

func (emptyDataset) ReadAt(int64, int) ([]byte, error) { return nil, io.EOF }
func (emptyDataset) WriteAt(int64, []byte) error       { return nil }
func (emptyDataset) Size() (int64, error)              { return 0, nil }
func (emptyDataset) Close() error                      { return nil }
