package crc32x

import (
	"encoding/binary"
	"hash/crc32"
)

// Crc32Combine is ZCL_OSD_CRC32=>COMBINE: the CRC-32 register (reflected
// polynomial EDB88320, most significant byte first, not inverted, as the
// ABAP keeps it) carried over data. hash/crc32 takes and returns the
// inverted value, so the register is inverted on the way in and out.
func Combine(crc string, data string) string {
	var reg uint32
	if len(crc) >= 4 {
		reg = binary.BigEndian.Uint32([]byte(crc[:4]))
	}
	reg = ^crc32.Update(^reg, crc32.IEEETable, []byte(data))
	var out [4]byte
	binary.BigEndian.PutUint32(out[:], reg)
	return string(out[:])
}
