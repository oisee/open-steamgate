# Streaming zip in ABAP (X2)

`src/zip/` reads a zip archive piece by piece, in plain ABAP, the same way on a
system, on the Node runtime and on the Go build:

| object | what it is |
|---|---|
| `ZCL_OSD_INFLATE` | raw DEFLATE (RFC 1951) decoder that takes its input in pieces |
| `ZCL_OSD_ZIP_READER` | central directory, `OPEN` an entry, `READ` it piece by piece, size and CRC-32 checked at its end |
| `ZIF_OSD_ZIP_SOURCE` | where the bytes come from, by position |
| `ZCL_OSD_ZIP_SOURCE_DATASET` | a file, through `OPEN DATASET` / `SET DATASET POSITION` / `READ DATASET ... MAXIMUM LENGTH` |
| `ZCL_OSD_ZIP_SOURCE_X` | an archive already in memory |
| `ZCL_OSD_CRC32` | CRC-32 over pieces |

```abap
CREATE OBJECT lo_source EXPORTING iv_file = `/data/in/export.zip`.
TRY.
    CREATE OBJECT lo_zip EXPORTING io_source = lo_source.
    lo_zip->open( `export/big.xml` ).
    WHILE lo_zip->is_eof( ) = abap_false.
      lv_piece = lo_zip->read( ).       " see "Memory" below
      " ... hand lv_piece on
    ENDWHILE.
  CLEANUP.
    lo_source->close( ).
ENDTRY.
lo_source->close( ).
```

## Memory

Each `READ` is bounded by its two parameters: `IV_MAX` bytes of compressed
input read from the source (default 64 KiB) and `IV_MAX_OUT` bytes of output
returned (default 1 MiB; a deflate match may add up to 257 bytes more). When
the output limit stops the decoder, the rest of what was read waits inside it
and the next `READ` reads nothing new until it is used up. Besides that the
decoder keeps its history (32 to 64 KiB, briefly one stored step more), and
the reader keeps the central directory (read once, about 50 to 100 bytes an
entry) and the last 64 KiB of the archive while it is opened.

An entry that inflates to more than its directory size is stopped at the
`READ` where that shows, not at its end: a zip bomb costs one output limit.
After a failed check no entry is open and a further `READ` raises too.

Several entries can be read at once: each `ZCL_OSD_ZIP_READER` holds its own
position, decoder and checksum, and a source is read by position only, so
several readers can share one `ZCL_OSD_ZIP_SOURCE_DATASET` (a dataset can be
open only once per session) and be read in turn.

## Why our own decoder

The standard `CL_ABAP_UNGZIP_BINARY_STREAM` was measured on a 7.5x system
first (2026-09-30, a throwaway probe, deleted). It does decode raw DEFLATE fed
in pieces of any size, so a zip entry can be streamed on a system. But:

- a stream cut short ends **without an exception**: half of a stream gave
  half of the output and nothing else;
- the output handler (`IF_ABAP_UNGZIP_BINARY_HANDLER~USE_OUT_BUF`) is a
  static method, so its state is per class, not per stream;
- a gzip header is not recognised unless `PARSE_HEADER` is called first
  (without it: `CX_SY_COMPRESSION_ERROR`, return code 30).

`ZCL_OSD_INFLATE` depends on no kernel module, runs the same everywhere, and
raises on a cut or damaged stream. Its Huffman decoding follows RFC 1951 and
zlib's `puff.c`; code-completeness follows zlib's `inflate_table`. The same
text compressed by zlib and by `CL_ABAP_GZIP=>COMPRESS_BINARY` on the system
gave the same length (1145 bytes) and the same first bytes (`75DA4BAA`); the
tests use zlib's.

Also measured on the system, for comparison: `CL_ABAP_ZIP` lists entries in
the order they were added, and `LOAD` of bytes that are no zip at all returns
`sy-subrc 0`.

## Speed

One stream, 1 MiB of text: **Node 0.155 MiB/s** (6.4 s), **Go at least
11 MiB/s** (1000 decodes of the 10892-byte test text in under a second,
including start-up). The history is kept between 32 and 64 KiB inside the
loop (briefly one stored step more); before that it held the whole output of a piece and 1 MiB took 48 s on
Node. On Node the cost is now the transpiled ABAP per symbol, as for sXML
(X1b); the binary path is Go.

## Not read

ZIP64 (archives or entries of 2 GiB and more), encrypted entries, split
archives, archives with data in front of them (self-extracting ones: the
first local header is not where the directory says), compression methods
other than stored (0) and deflate (8). `CL_ABAP_ZIP` on the system has no
ZIP64 either. Names are decoded as UTF-8 whether or not the entry sets the
UTF-8 flag; a name that is not valid UTF-8 becomes empty. Of two entries
with the same name, `OPEN` takes the first. The end-of-directory record is
taken only where its comment ends the archive exactly, so a comment that
contains its signature is not mistaken for it, and an archive with bytes
after its comment is refused.

## Go build

Three constructs the Go generator does not compile yet were written around in
the ABAP (offset/length write targets, `DELETE itab FROM n`, an x-typed
instance attribute with `VALUE`); they are on the U3 list.

## Tests

`test/unit/zcl_osd_inflate_test` (dynamic, fixed and stored blocks, input in
1/7/13/100-byte pieces, cut and damaged streams, bytes after the end) and
`test/unit/zcl_osd_zip_test` (a 1781-byte archive written by Python's
`zipfile`: deflate, stored, a directory, a UTF-8 name, a comment; a damaged
entry; `DATASET_SOURCE` writes the archive with `TRANSFER` and reads it back
through `OPEN DATASET`, and needs a dataset write root, `OSD_DATASET_WRITE`).
