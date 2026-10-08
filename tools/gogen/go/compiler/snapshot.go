package compiler

import (
	"context"
	"crypto/sha256"
	"errors"
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
// outside the root handle held for this build. Special files are rejected and
// the total bytes read are bounded by maxSnapshotBytes.
func BuildSnapshot(ctx context.Context, root, generation string, objects []ObjectFiles, maxSnapshotBytes int64) (Snapshot, error) {
	if maxSnapshotBytes <= 0 {
		return Snapshot{}, &SnapshotPathError{Reason: "invalid", Path: "."}
	}
	rootFile, err := os.OpenRoot(root)
	if err != nil {
		return Snapshot{}, err
	}
	defer rootFile.Close()
	snapshot := Snapshot{Root: root, Generation: generation, Objects: make([]Object, 0, len(objects))}
	var total int64
	for _, input := range objects {
		if err := ctx.Err(); err != nil {
			return Snapshot{}, err
		}
		object := Object{Type: input.Type, Name: input.Name, Version: input.Version, Files: []File{}}
		for index, path := range input.Files {
			if err := ctx.Err(); err != nil {
				return Snapshot{}, err
			}
			clean := filepath.Clean(path)
			if filepath.IsAbs(path) {
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "absolute"}
			}
			if escapes(clean) {
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "parent-relative"}
			}
			file, err := openSnapshotFile(rootFile, clean)
			if err != nil {
				return Snapshot{}, err
			}
			info, statErr := file.Stat()
			if statErr != nil {
				_ = file.Close()
				return Snapshot{}, statErr
			}
			if !info.Mode().IsRegular() {
				_ = file.Close()
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "not-regular"}
			}
			hash := sha256.New()
			var read int64
			buffer := make([]byte, min(64*1024, maxSnapshotBytes+1))
			for {
				if read == maxSnapshotBytes+1 || total+read == maxSnapshotBytes+1 {
					_ = file.Close()
					return Snapshot{}, &SnapshotPathError{Path: path, Reason: "too-large"}
				}
				limit := maxSnapshotBytes + 1 - max(read, total+read)
				if limit > int64(len(buffer)) {
					limit = int64(len(buffer))
				}
				count, readErr := file.Read(buffer[:limit])
				if count > 0 {
					hash.Write(buffer[:count])
					read += int64(count)
				}
				if readErr != nil {
					if errors.Is(readErr, io.EOF) {
						break
					}
					closeErr := file.Close()
					if closeErr != nil {
						return Snapshot{}, closeErr
					}
					return Snapshot{}, readErr
				}
			}
			closeErr := file.Close()
			if read > maxSnapshotBytes || total+read > maxSnapshotBytes {
				if closeErr != nil {
					return Snapshot{}, closeErr
				}
				return Snapshot{}, &SnapshotPathError{Path: path, Reason: "too-large"}
			}
			total += read
			logical := ""
			if index < len(input.Logical) {
				logical = input.Logical[index]
			}
			object.Files = append(object.Files, File{Path: filepath.ToSlash(clean), LogicalPath: logical, SHA256: fmt.Sprintf("%x", hash.Sum(nil))})
		}
		snapshot.Objects = append(snapshot.Objects, object)
	}
	return snapshot, nil
}
func escapes(path string) bool {
	return path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator))
}
