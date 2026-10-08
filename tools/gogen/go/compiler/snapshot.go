package compiler

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type SnapshotPathError struct {
	Path   string
	Reason string
}

func (e *SnapshotPathError) Error() string {
	return fmt.Sprintf("%s path %s", e.Reason, e.Path)
}

// BuildSnapshot hashes raw bytes through an os.Root. A lexical absolute or ..
// refusal is reported as *SnapshotPathError; a swapped symlink cannot reopen
// outside the root handle held for this build.
func BuildSnapshot(root, generation string, objects []ObjectFiles) (Snapshot, error) {
	rootFile, err := os.OpenRoot(root)
	if err != nil {
		return Snapshot{}, err
	}
	defer rootFile.Close()
	snapshot := Snapshot{Root: root, Generation: generation, Objects: make([]Object, 0, len(objects))}
	for _, input := range objects {
		object := Object{Type: input.Type, Name: input.Name, Version: input.Version, Files: []File{}}
		for _, path := range input.Files {
			clean := filepath.Clean(path)
			if filepath.IsAbs(path) {
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "absolute"}
			}
			if escapes(clean) {
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "parent-relative"}
			}
			file, err := rootFile.Open(clean)
			if err != nil {
				return Snapshot{}, err
			}
			raw, readErr := io.ReadAll(file)
			closeErr := file.Close()
			if readErr != nil {
				return Snapshot{}, readErr
			}
			if closeErr != nil {
				return Snapshot{}, closeErr
			}
			object.Files = append(object.Files, File{Path: filepath.ToSlash(clean), SHA256: fmt.Sprintf("%x", sha256.Sum256(raw))})
		}
		snapshot.Objects = append(snapshot.Objects, object)
	}
	return snapshot, nil
}
func escapes(path string) bool {
	return path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator))
}
