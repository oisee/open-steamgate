//go:build !unix

package sandbox

// noFollow: no such flag here; the realpath checks stand alone
const noFollow = 0

func isSymlinkLoop(error) bool { return false }
