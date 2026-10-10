package sandbox

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// PinnedRead owns checked startup authority. Close it unless InstallRead
// transfers ownership to a sandbox. It is never callable from ABAP.
type PinnedRead struct {
	Name, path string
	fileGrant
	directory *os.Root
}

// PinRead resolves an initial symlink, opens the target once and classifies
// that descriptor. Keep its root/fd and identity through installation.
// Directories are opened once as os.Root, files once as a file descriptor,
// beneath an open parent. A FIFO swap cannot block the regular-file check.
func PinRead(name string) (*PinnedRead, error) { return pinRead(name, nil) }

// PinRead uses the startup test seam after checking the target identity.
func (sb *Sandbox) PinRead(name string) (*PinnedRead, error) {
	return pinRead(name, sb.BeforeGrantOpen)
}

func pinRead(name string, beforeOpen func()) (*PinnedRead, error) {
	abs, err := filepath.Abs(name)
	if err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, err
	}
	checked, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if !checked.IsDir() && !checked.Mode().IsRegular() {
		return nil, fmt.Errorf("grant target is not a regular file or directory")
	}
	if beforeOpen != nil {
		beforeOpen()
	}
	entry := filepath.Base(real)
	if filepath.Dir(real) == real {
		entry = "." // filesystem/drive/UNC share root
	}
	root, err := os.OpenRoot(filepath.Dir(real))
	if err != nil {
		return nil, err
	}
	g := &PinnedRead{Name: abs, path: real, fileGrant: fileGrant{root: root}}
	if checked.IsDir() {
		g.directory, err = root.OpenRoot(entry)
		if err == nil {
			g.info, err = g.directory.Stat(".")
		}
	} else {
		g.pin, err = root.OpenFile(entry, os.O_RDONLY|noFollow|nonBlock, 0)
		if err == nil {
			g.info, err = g.pin.Stat()
		}
	}
	if err == nil && !os.SameFile(checked, g.info) {
		err = fmt.Errorf("grant target changed while pinning")
	}
	if err != nil {
		g.Close()
		return nil, err
	}
	return g, nil
}

func (g *PinnedRead) IsDir() bool { return g.info.IsDir() }

// ResolvedName is the checked target name, without any new filesystem lookup.
func (g *PinnedRead) ResolvedName() string { return g.path }

// Reader parses a list from the very descriptor retained by its file grant.
func (g *PinnedRead) Reader() io.Reader { return io.NewSectionReader(g.pin, 0, 1<<63-1) }

func (g *PinnedRead) Close() {
	if g.pin != nil {
		g.pin.Close()
		g.pin = nil
	}
	if g.root != nil {
		g.root.Close()
		g.root = nil
	}
	if g.directory != nil {
		g.directory.Close()
		g.directory = nil
	}
}

// InstallRead transfers checked handles, without resolving or opening a path.
// Call before exposing the sandbox to a report. Duplicate grants are closed.
func (sb *Sandbox) InstallRead(g *PinnedRead) {
	sb.roots()
	if sb.BeforeGrantInstall != nil {
		sb.BeforeGrantInstall()
	}
	sb.installRead(g)
}

func (sb *Sandbox) installRead(g *PinnedRead) {
	if g.IsDir() {
		if sb.handles[g.path] == nil {
			sb.Read = append(sb.Read, g.Name)
			sb.read = append(sb.read, g.path)
			sb.browseRead = append(sb.browseRead, g.path)
			sb.handles[g.path] = g.directory
			g.directory = nil
		}
		g.Close()
	} else if _, exists := sb.files[g.path]; exists {
		g.Close()
	} else {
		sb.files[g.path] = g.fileGrant
		g.pin, g.root = nil, nil // sandbox now owns both descriptors
	}
}
