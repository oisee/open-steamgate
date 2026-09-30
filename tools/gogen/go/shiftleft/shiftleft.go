package shiftleft

import "strings"

// Leading removes characters from the left that occur in the mask.
func Leading(s, mask string) string {
	if mask == "" { return s }
	return strings.TrimLeft(s, mask)
}
