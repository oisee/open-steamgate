# sxmlscan

Byte scanners for ZCL_OSD_SXML_PULL.

`NameEnd` finds the first byte outside an XML name.
`SpaceEnd` skips the four XML whitespace bytes.
Both offsets are byte positions from the supplied start.
`Utf8Text` accepts valid UTF-8 text without a leading BOM.
The scanners do not depend on ABAP state.
They allocate no data beyond returned results.
