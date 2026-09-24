CLASS zcl_gogen_t_xarith DEFINITION PUBLIC FINAL CREATE PUBLIC.
* x and xstring operands in arithmetic (CL_ABAP_ZIP's CRC-32: cindex DIV 2,
* idx * 4, crc DIV 256 over x LENGTH 4): the calculation type, and the
* result moved into an x or an i
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xarith IMPLEMENTATION.
  METHOD run.
    DATA lv_x4 TYPE x LENGTH 4.
    DATA lv_r4 TYPE x LENGTH 4.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_x8 TYPE x LENGTH 8.
    DATA lv_xs TYPE xstring.
    DATA lv_i TYPE i.
    DATA lv_p TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_pp TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_f TYPE f.
    DATA lv_fp TYPE p LENGTH 8 DECIMALS 2.

    lv_x4 = 'EDB88320'.
    lv_r4 = lv_x4 DIV 2.
    lv_i = lv_x4 DIV 2.
    rv = |div:{ lv_r4 }/{ lv_i }|.
    lv_r4 = lv_x4 MOD 7.
    rv = |{ rv } mod:{ lv_r4 }|.
    lv_x4 = '000000FF'.
    lv_r4 = lv_x4 * 4.
    rv = |{ rv } mul:{ lv_r4 }|.
    lv_x4 = 'FFFFFFFF'.
    lv_r4 = lv_x4 DIV 256.
    lv_i = lv_x4 + 1.
    rv = |{ rv } ff:{ lv_r4 }/{ lv_i }|.
    lv_x1 = 'FF'.
    lv_i = lv_x1 + 1.
    rv = |{ rv } x1:{ lv_i }|.
    lv_x2 = 'FFFF'.
    lv_i = lv_x2 + 1.
    rv = |{ rv } x2:{ lv_i }|.
    lv_x8 = '00000001000000FF'.
    lv_i = lv_x8 + 0.
    rv = |{ rv } x8:{ lv_i }|.
    lv_xs = 'FF'.
    lv_i = lv_xs + 1.
    rv = |{ rv } xs:{ lv_i }|.
    lv_x1 = '0A'.
    lv_pp = '1.5'.
    lv_p = lv_x1 + lv_pp.
    rv = |{ rv } p:{ lv_p }|.
    lv_f = '0.25'.
    lv_f = lv_x1 + lv_f.
    lv_fp = lv_f.
    rv = |{ rv } f:{ lv_fp }|.
    lv_x1 = '07'.
    lv_i = lv_x1 / 2.
    rv = |{ rv } div2:{ lv_i }|.
  ENDMETHOD.
ENDCLASS.
