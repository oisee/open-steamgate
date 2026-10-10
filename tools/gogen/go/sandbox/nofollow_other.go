//go:build !unix

package sandbox

// noFollow: no such flag here; os.Root and the descriptor identity check apply
const noFollow = 0

func isSymlinkLoop(error) bool { return false }

const nonBlock = 0
