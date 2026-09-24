CLASS zcl_gogen_t_xmovi DEFINITION PUBLIC FINAL CREATE PUBLIC.
* x / xstring moved into an i, measured on A4H 2026-09-24 ($ZOSG_TMP_0481,
* the same class as an ABAP Unit probe; ZCL_ABAPGIT_CONVERT=>XSTRING_TO_INT
* is such a move): the last four bytes, 00 on the left, a signed int32
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS short RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS longx RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS longxs RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xmovi IMPLEMENTATION.
  METHOD run.
    rv = |{ short( ) } { longx( ) } { longxs( ) }|.
  ENDMETHOD.

  METHOD short.
    DATA lv_xs TYPE xstring.
    DATA lv_x4 TYPE x LENGTH 4.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_i TYPE i.
    lv_xs = '0000000B'.
    lv_i = lv_xs.
    rv = |a:{ lv_i }|.
    lv_xs = 'FFFFFFFF'.
    lv_i = lv_xs.
    rv = |{ rv } b:{ lv_i }|.
    lv_xs = 'FF'.
    lv_i = lv_xs.
    rv = |{ rv } c:{ lv_i }|.
    lv_xs = '0102'.
    lv_i = lv_xs.
    rv = |{ rv } d:{ lv_i }|.
    CLEAR lv_xs.
    lv_i = 7.
    lv_i = lv_xs.
    rv = |{ rv } e:{ lv_i }|.
    lv_xs = '80000000'.
    lv_i = lv_xs.
    rv = |{ rv } f:{ lv_i }|.
    lv_x4 = 'FFFFFFFE'.
    lv_i = lv_x4.
    rv = |{ rv } g:{ lv_i }|.
    lv_x1 = 'FF'.
    lv_i = lv_x1.
    rv = |{ rv } h:{ lv_i }|.
  ENDMETHOD.

  METHOD longx.
    DATA lv_x5 TYPE x LENGTH 5.
    DATA lv_i TYPE i.
    lv_x5 = '0100000002'.
    lv_i = lv_x5.
    rv = |x5:{ lv_i }|.
  ENDMETHOD.

  METHOD longxs.
    DATA lv_xs TYPE xstring.
    DATA lv_i TYPE i.
    lv_xs = '0100000002'.
    lv_i = lv_xs.
    rv = |xs5:{ lv_i }|.
  ENDMETHOD.
ENDCLASS.
