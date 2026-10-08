package compiler

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// BuildSnapshot hashes raw bytes and rejects lexical and symlink escapes.
func BuildSnapshot(root, generation string, objects []ObjectFiles) (Snapshot, error) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return Snapshot{}, err
	}
	realRoot, err = filepath.Abs(realRoot)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{Root: realRoot, Generation: generation, Objects: make([]Object, 0, len(objects))}
	for _, input := range objects {
		object := Object{Type: input.Type, Name: input.Name, Version: input.Version, Files: []File{}}
		for _, path := range input.Files {
			if filepath.IsAbs(path) || escapes(filepath.Clean(path)) {
				return Snapshot{}, fmt.Errorf("path escapes root: %s", path)
			}
			real, err := filepath.EvalSymlinks(filepath.Join(realRoot, path))
			if err != nil {
				return Snapshot{}, err
			}
			rel, err := filepath.Rel(realRoot, real)
			if err != nil || escapes(rel) {
				return Snapshot{}, fmt.Errorf("path escapes root: %s", path)
			}
			raw, err := os.ReadFile(real)
			if err != nil {
				return Snapshot{}, err
			}
			object.Files = append(object.Files, File{Path: filepath.ToSlash(filepath.Clean(path)), SHA256: fmt.Sprintf("%x", sha256.Sum256(raw))})
		}
		snapshot.Objects = append(snapshot.Objects, object)
	}
	return snapshot, nil
}
func escapes(path string) bool {
	return path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator))
}
