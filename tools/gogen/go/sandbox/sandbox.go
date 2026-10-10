// Package sandbox is the disk behind DATASET and the file dialogs:
// nothing is reachable unless explicit roots or single-file reads grant it.
// Directory roots come from OSD_DATASET_READ / OSD_DATASET_WRITE; names
// are resolved to their real paths and compared with the
// roots' real paths as directories, every open and unlink goes through an
// os.Root of the root that holds the path (no symlink escape between the
// checks and the open), a refusal is the MESSAGE text, and
// OSD_DATASET_AUDIT gets one JSON line per OPEN and DELETE. The rules are
// tools/osd-dataset.mjs's. go/abap keeps the statements (OPEN / READ /
// TRANSFER ... DATASET) and names these types under its old names.
package sandbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Mode string

const (
	Input     Mode = "INPUT"
	Output    Mode = "OUTPUT"
	Appending Mode = "APPENDING"
	Update    Mode = "UPDATE"
)

// Handle is an open file; the runtime keeps the position.
type Handle interface {
	// ReadAt answers up to n bytes from pos, fewer only at the end.
	ReadAt(pos int64, n int) ([]byte, error)
	WriteAt(pos int64, b []byte) error
	Size() (int64, error)
	Close() error
}

// Host opens by name; a refusal or failure is the MESSAGE text and
// becomes sy-subrc 8. Delete is false when there was nothing to delete.
type Host interface {
	Open(name string, mode Mode) (Handle, string)
	Delete(name string) bool
}

// Sandbox is the disk behind roots; a write root is readable too. Home
// resolves a relative name (default the first write root, else the first
// read root). Audit, when set, gets every OPEN and DELETE.
type Sandbox struct {
	Read, Write []string
	// ReadFiles grants only resolved regular files, never their parent directories.
	ReadFiles []string
	files     map[string]fileGrant
	base      string // implicit DATASET home, captured from explicit roots only
	// BeforeGrantInstall runs after classification (and list parsing), before
	// ownership of the checked handles is transferred. Tests only.
	BeforeGrantInstall func()
	// BeforeGrantOpen runs between startup Stat and pinning. Tests only.
	BeforeGrantOpen func()
	Home            string
	Audit           func(entry map[string]any)
	CreatePerm      os.FileMode
	// BeforeOpen runs between the path checks and the open or unlink; only
	// tests set it, to stand in for another process at that moment
	BeforeOpen              func()
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
	for _, grant := range sb.files {
		if err := grant.pin.Close(); err != nil && first == nil {
			first = err
		}
		if err := grant.root.Close(); err != nil && first == nil {
			first = err
		}
	}
	for _, root := range sb.handles {
		if err := root.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// FromEnv is the sandbox of OSD_DATASET_READ / OSD_DATASET_WRITE /
// OSD_DATASET_HOME / OSD_DATASET_AUDIT, the variables tools/osd-dataset.mjs
// reads; with neither root set it refuses everything.
func FromEnv() *Sandbox {
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
			if f, _ := auditHost.Open(file, Appending); f != nil {
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
		if len(sb.write) > 0 {
			sb.base = sb.write[0]
		} else if len(sb.read) > 0 {
			sb.base = sb.read[0]
		}
		sb.files = map[string]fileGrant{}
		for _, name := range sb.ReadFiles {
			grant, err := PinRead(name)
			if err != nil {
				fmt.Fprintf(os.Stderr, "read: warning: %s: %v\n", name, err)
				continue
			}
			if grant.IsDir() {
				grant.Close()
				fmt.Fprintf(os.Stderr, "read: warning: %s: not a regular file\n", name)
				continue
			}
			sb.installRead(grant)
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
	f, err := root.Open(rel)
	return real, f, err
}

// BrowseEntry inspects directory entries without opening them. Exact file
// grants use a nonblocking, identity-checked open; FIFOs never wait for a writer.
func (sb *Sandbox) BrowseEntry(name string, save bool) (string, os.FileInfo, error) {
	_, write := sb.roots()
	if !save {
		if h, _, matched := sb.openFileGrant(name); matched && h != nil {
			defer h.Close()
			info, err := h.(*osDataset).f.Stat()
			real, resolveErr := sb.datasetName(name)
			if err == nil {
				err = resolveErr
			}
			return real, info, err
		}
	}
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
		if info.IsDir() || !info.Mode().IsRegular() {
			return "", errors.New("cannot save to a directory")
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
	wanted, _ := sb.datasetName(name)
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
func (sb *Sandbox) Open(name string, mode Mode) (Handle, string) {
	read, write := sb.roots()
	if mode == Input {
		if h, message, matched := sb.openFileGrant(name); matched {
			if h != nil || len(read) == 0 {
				return h, message
			}
			// Authority is additive: an independently granted directory may
			// still permit a replacement refused by an exact-file grant.
		}
	}
	roots, given := read, append(append([]string{}, sb.Read...), sb.Write...)
	if mode != Input {
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
	case Input:
		flags = os.O_RDONLY
	case Output:
		// truncated only after the descriptor is checked below
		flags = os.O_RDWR | os.O_CREATE
	case Appending:
		flags = os.O_RDWR | os.O_CREATE
	default:
		flags = os.O_RDWR
	}
	if sb.BeforeOpen != nil {
		sb.BeforeOpen()
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
	if mode == Output {
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
	if sb.BeforeOpen != nil {
		sb.BeforeOpen()
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
