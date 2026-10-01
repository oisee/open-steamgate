//go:build windows

package abap

import "os"

func openBrowseDirectory(root *os.Root, rel string) (*os.File, error) {
	info, err := root.Stat(rel)
	if err != nil { return nil, err }
	if !info.IsDir() { return nil, os.ErrInvalid }
	return root.Open(rel)
}
