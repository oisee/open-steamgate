* Inflate, done by the platform instead of by hand.
*
* abapGit carries its own DEFLATE, written in ABAP because a system does
* not always have a kernel call that fits: bit by bit, Huffman table by
* Huffman table. It is correct and it is slow, and transpiled to
* JavaScript it is slow enough that a pack of a few hundred kilobytes does
* not finish in two minutes.
*
* It gets used more than one would think. abapGit prefers cl_abap_gzip for
* the common '789C' header, but only after it recompresses the result and
* compares it byte for byte with the original, to learn how many bytes the
* stream ate. Any compressor that does not produce the exact same bytes as
* the one that wrote the pack fails that comparison, and git's does not
* match Node's, so nearly every object of a real pack falls back to the
* ABAP inflate.
*
* Node has inflate in its kernel and will say how much input it consumed,
* which is the one thing the ABAP version was being asked for. So this
* replaces zcl_abapgit_zlib with the same signature and the same answer.
* The name is abapGit's because zcl_abapgit_git_pack calls it by name; the
* real one is excluded from the library in abap_transpile.json, the way
* express-icf-shim replaces ICF.
CLASS zcl_abapgit_zlib DEFINITION
  PUBLIC
  CREATE PUBLIC .

  PUBLIC SECTION.

    TYPES:
      BEGIN OF ty_decompress,
        raw            TYPE xstring,
        compressed_len TYPE i,
      END OF ty_decompress .

    " a raw deflate stream, header already stripped by the caller, with
    " whatever follows it still attached: raw is what came out and
    " compressed_len is how many bytes of the input that took
    CLASS-METHODS decompress
      IMPORTING
        !iv_compressed TYPE xsequence
      RETURNING
        VALUE(rs_data) TYPE ty_decompress .

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.



CLASS zcl_abapgit_zlib IMPLEMENTATION.


  METHOD decompress.

    DATA lv_input TYPE xstring.
    DATA lv_raw   TYPE xstring.
    DATA lv_len   TYPE i.

    lv_input = iv_compressed.

    WRITE '@KERNEL const zlib = await import("node:zlib");'.
    WRITE '@KERNEL const input = Buffer.from(lv_input.get(), "hex");'.
    WRITE '@KERNEL try {'.
    WRITE '@KERNEL   const out = zlib.inflateRawSync(input, {info: true});'.
    WRITE '@KERNEL   lv_raw.set(out.buffer.toString("hex").toUpperCase());'.
    WRITE '@KERNEL   lv_len.set(out.engine.bytesWritten);'.
    WRITE '@KERNEL } catch (e) {'.
*   a failure here is "the stream did not inflate", which the caller reads
*   as a length of zero and turns into its own exception
    WRITE '@KERNEL   lv_len.set(0);'.
    WRITE '@KERNEL }'.

    rs_data-raw = lv_raw.
    rs_data-compressed_len = lv_len.

  ENDMETHOD.

ENDCLASS.
