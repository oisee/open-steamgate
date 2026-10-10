// Package readgrant computes host-owned startup reads from explicit user input.
// It has no dependency on ABAP and no callable report API.
package readgrant

import (
	"bufio"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"osg/gogen/sandbox"
)

// Apply runs before report construction. Startup values use cwd, independently
// of the DATASET home. Classification, list parsing and installation share the
// checked descriptors; no pathname is reopened to install authority.
func Apply(sb *sandbox.Sandbox, values map[string]string, params, lists []string, disabled bool, stderr io.Writer) {
	if disabled {
		return
	}
	var summary []string
	warn := func(value, name string, err error) {
		fmt.Fprintf(stderr, "read: warning: %s (%s): %v\n", value, name, err)
	}
	for _, name := range params {
		if value := values[name]; value != "" {
			g, err := sb.PinRead(value)
			if err != nil {
				warn(value, name, err)
				continue
			}
			path := g.Name
			sb.InstallRead(g)
			summary = append(summary, fmt.Sprintf("%s (%s)", path, name))
		}
	}
	for _, name := range lists {
		value := values[name]
		if value == "" {
			continue
		}
		g, err := sb.PinRead(value)
		var entries []string
		if err == nil {
			if g.IsDir() {
				err = fmt.Errorf("list is not a regular file")
			} else {
				entries, err = ParseList(g.Reader(), filepath.Dir(g.Name))
			}
		}
		if err != nil {
			if g != nil {
				g.Close()
			}
			warn(value, name, err)
			continue // fail closed: not even the list itself is granted
		}
		path, real := g.Name, g.ResolvedName()
		sb.InstallRead(g)
		count := 0
		for _, entry := range entries {
			// Self-listing already has the list's checked file authority. Do
			// not reclassify it if it was replaced by a directory meanwhile.
			if entry == path || entry == real {
				count++
				continue
			}
			grant, err := sb.PinRead(entry)
			if err != nil {
				warn(entry, name, err)
				continue
			}
			if grant.ResolvedName() == real { // a symlink alias of the list
				grant.Close()
			} else {
				sb.InstallRead(grant)
			}
			count++
		}
		item := fmt.Sprintf("%s (%s)", path, name)
		if count > 0 {
			item += fmt.Sprintf(" + %d from %s", count, filepath.Base(path))
		}
		summary = append(summary, item)
	}
	if len(summary) > 0 {
		fmt.Fprintln(stderr, "read: "+strings.Join(summary, ", "))
	}
}

const (
	MaxListEntries = 10000
	MaxListBytes   = 4 * 1024 * 1024
)

// ParseList bounds the whole stream (including comments) before any grants are
// installed. Relative entries use the list directory. Strip only an initial
// UTF-8 BOM; ScanLines and TrimSpace handle CRLF and surrounding whitespace.
func ParseList(r io.Reader, directory string) ([]string, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxListBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxListBytes {
		return nil, fmt.Errorf("list exceeds %d bytes", MaxListBytes)
	}
	var paths []string
	scanner := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(string(data), "\ufeff")))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if len(paths) == MaxListEntries {
			return nil, fmt.Errorf("list exceeds %d entries", MaxListEntries)
		}
		if !filepath.IsAbs(line) {
			line = filepath.Join(directory, line)
		}
		paths = append(paths, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return paths, nil
}
