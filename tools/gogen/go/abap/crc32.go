package abap

import "osg/gogen/crc32x"

func Crc32Combine(s *Session, crc string, data string) string { return crc32x.Combine(crc, data) }
