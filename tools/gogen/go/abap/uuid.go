package abap

import (
	"crypto/rand"
	"fmt"
)

// UUIDRandom is CL_SYSTEM_UUID=>RANDOM, the one method of the class that
// open-abap-core writes as '@KERNEL' JavaScript (crypto.randomUUID()): a
// random RFC 4122 version 4 UUID in its 36-character text form, lower case
// with hyphens, exactly the shape Node gives. The class's CREATE_UUID_X16 /
// C22 / C32 / C36 are ABAP around this call (hyphens removed, upper-cased,
// cut) and compile as they are; CONVERT_UUID_X16 is ASSERT 1 = 'todo' on
// Node as well, so it is not a host function here either.
func UUIDRandom(s *Session) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("CL_SYSTEM_UUID=>RANDOM: %v", err))
	}
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // variant 10xx
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
