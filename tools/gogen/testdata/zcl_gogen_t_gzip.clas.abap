CLASS zcl_gogen_t_gzip DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS trip
      IMPORTING iv_in      TYPE xstring
      RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS inflate
      IMPORTING iv_in      TYPE xstring
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_gzip IMPLEMENTATION.
  METHOD trip.
* compress, then decompress: the input again, GZIP_OUT_LEN the length of
* what was written; the compressed bytes themselves are the encoder's
    DATA lv_out TYPE xstring.
    DATA lv_len TYPE i.
    DATA lv_back TYPE xstring.
    DATA lv_blen TYPE i.
    DATA lv_same TYPE string.
    DATA lv_lok TYPE string.
    cl_abap_gzip=>compress_binary(
      EXPORTING raw_in       = iv_in
      IMPORTING gzip_out     = lv_out
                gzip_out_len = lv_len ).
    cl_abap_gzip=>decompress_binary(
      EXPORTING gzip_in     = lv_out
      IMPORTING raw_out     = lv_back
                raw_out_len = lv_blen ).
    lv_same = '0'.
    IF lv_back = iv_in.
      lv_same = '1'.
    ENDIF.
    lv_lok = '0'.
    IF lv_len = xstrlen( lv_out ).
      lv_lok = '1'.
    ENDIF.
    rv = |{ lv_same }{ lv_lok }/{ lv_blen }|.
  ENDMETHOD.

  METHOD inflate.
    DATA lv_back TYPE xstring.
    DATA lv_blen TYPE i.
    cl_abap_gzip=>decompress_binary(
      EXPORTING gzip_in     = iv_in
      IMPORTING raw_out     = lv_back
                raw_out_len = lv_blen ).
    rv = |{ lv_back }/{ lv_blen }|.
  ENDMETHOD.

  METHOD run.
    DATA lv_x TYPE xstring.
    DATA lv_text TYPE string.
    DATA lv_big TYPE xstring.
    DATA lv_out TYPE xstring.
    DATA lv_len TYPE i.
    DATA lv_small TYPE string.
    DATA lv_i TYPE i.

    lv_x = '1122334411223344'.
    rv = |rt:{ trip( lv_x ) }|.
    CLEAR lv_x.
    rv = |{ rv } e:{ trip( lv_x ) }|.
* a text that compresses: 100 times the same 10 bytes
    DO 100 TIMES.
      lv_text = |{ lv_text }abcdefghij|.
    ENDDO.
    lv_big = cl_abap_codepage=>convert_to( lv_text ).
    rv = |{ rv } big:{ trip( lv_big ) }|.
    cl_abap_gzip=>compress_binary(
      EXPORTING raw_in       = lv_big
      IMPORTING gzip_out     = lv_out
                gzip_out_len = lv_len ).
    lv_small = '0'.
    IF lv_len < 100.
      lv_small = '1'.
    ENDIF.
    rv = |{ rv } small:{ lv_small }|.
* raw DEFLATE streams of 11223344: zlib's, and one with a sync marker
* before an empty final block
    lv_x = '135432760100'.
    rv = |{ rv } z:{ inflate( lv_x ) }|.
    lv_x = '1254327601040000FFFF'.
    rv = |{ rv } s:{ inflate( lv_x ) }|.
  ENDMETHOD.
ENDCLASS.
