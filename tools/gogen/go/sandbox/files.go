package sandbox

import (
	"os"
	"path/filepath"
	"strings"
)

type fileGrant struct {
	root *os.Root
	info os.FileInfo
	pin  *os.File
}

// A symlink supplied as a grant resolves to its regular-file target. Pin the
// target's identity: os.Root confines parent traversal, and SameFile also
// refuses a final-component swap to a sibling inside that parent (including
// on platforms without O_NOFOLLOW). Keep the original descriptor alive to
// prevent inode reuse after unlink. No data is read before this check.
func (sb *Sandbox) openFileGrant(name string) (Handle, string, bool) {
	wanted, err := sb.datasetName(name)
	if err != nil {
		return nil, "", false
	}
	real, err := filepath.EvalSymlinks(wanted)
	if err != nil {
		return nil, "", false
	}
	grant, ok := sb.files[real]
	if !ok {
		for path, pinned := range sb.files {
			if strings.EqualFold(path, real) && sameGrantName(path, real, pinned) {
				grant, ok = pinned, true
				break
			}
		}
		if !ok {
			return nil, "", false
		}
	}
	if sb.BeforeOpen != nil {
		sb.BeforeOpen()
	}
	f, err := grant.root.OpenFile(filepath.Base(real), os.O_RDONLY|noFollow|nonBlock, 0)
	if err == nil {
		info, statErr := f.Stat()
		if statErr == nil && info.Mode().IsRegular() && os.SameFile(grant.info, info) {
			sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(Input), "allowed": true, "path": real})
			return &osDataset{f: f}, "", true
		}
		f.Close()
	}
	if len(sb.read) == 0 { // Open audits any directory-root fallback itself.
		sb.note(map[string]any{"op": "OPEN", "name": name, "mode": string(Input), "allowed": false, "why": "granted file changed while opening"})
	}
	return nil, "Permission denied: granted file changed while opening", true
}

// datasetName preserves the historical DATASET base. Startup values use cwd
// separately in PinRead; adding grants never changes the implicit home.
func (sb *Sandbox) datasetName(name string) (string, error) {
	base := sb.Home
	if base == "" {
		base = sb.base
	}
	if !filepath.IsAbs(name) {
		name = filepath.Join(base, name)
	}
	return filepath.Abs(name)
}

// Case folding only selects candidates. Parent identity and the directory's
// actual names exclude distinct case-sensitive directories and hard-link names.
func sameGrantName(granted, candidate string, grant fileGrant) bool {
	root := grant.root
	// The granted spelling must still reach the pinned object. Otherwise a
	// renamed case-variant hard link on a case-sensitive filesystem would pass.
	original, err := root.Lstat(filepath.Base(granted))
	if err != nil || !original.Mode().IsRegular() || !os.SameFile(original, grant.info) {
		return false
	}
	parent, err := os.OpenRoot(filepath.Dir(candidate))
	if err != nil {
		return false
	}
	defer parent.Close()
	a, err := parent.Stat(".")
	if err != nil {
		return false
	}
	b, err := root.Stat(".")
	if err != nil || !os.SameFile(a, b) {
		return false
	}
	dir, err := root.Open(".")
	if err != nil {
		return false
	}
	defer dir.Close()
	names, err := dir.Readdirnames(-1)
	if err != nil {
		return false
	}
	return unambiguousGrantName(filepath.Base(granted), filepath.Base(candidate), names)
}

// The names seam tests case-insensitive lookup even on case-sensitive hosts.
func unambiguousGrantName(granted, candidate string, names []string) bool {
	if !strings.EqualFold(granted, candidate) {
		return false
	}
	matches := 0
	for _, name := range names {
		if strings.EqualFold(name, granted) {
			matches++
		}
	}
	return matches == 1
}
