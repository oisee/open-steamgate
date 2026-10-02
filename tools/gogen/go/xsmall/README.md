# Inline fixed bytes

The emitter uses a Go byte array for a local `x(1..8)` only when ownership
analysis proves it unescaped and it reads a constant span of owned memory.
Its width is part of the array type; the zero value has the ABAP initial bytes.
Whole reads make string snapshots for the existing ABI. Assignments copy in.
Integer moves operate directly on bytes with the same truncation, sign extension
and signed-i interpretation as `abap.IToX` and `abap.XToI`.

Unknown writes, substring targets, references and calls that expose the slot
retain the ordinary string storage. No array or mutable view crosses an ABAP
call or descriptor boundary. Buffer reads validate before changing the target;
equal-length stores validate before writing, and one-byte stores use one store.
