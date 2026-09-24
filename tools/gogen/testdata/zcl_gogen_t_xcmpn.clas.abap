CLASS zcl_gogen_t_xcmpn DEFINITION PUBLIC FINAL CREATE PUBLIC.
* x / xstring against i and n, measured on A4H 2026-09-24 ($ZOSG_TMP_0480):
* NUM is the probe ZCL_GOGEN_T_XCMP2=>NUM, LONG and LONG2 ZCL_GOGEN_T_XCMP3's
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS num RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS long RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS long2 RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xcmpn IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = '1'.
    ELSE.
      rv = '0'.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    rv = |{ num( ) } { long( ) } { long2( ) }|.
  ENDMETHOD.

  METHOD num.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_x4 TYPE x LENGTH 4.
    DATA lv_xs TYPE xstring.
    DATA lv_i TYPE i.
    DATA lv_n TYPE n LENGTH 4.
    DATA lv_r TYPE string.
    lv_x1 = '0A'.
    lv_x2 = '0100'.
    lv_x4 = 'FFFFFFFF'.
    lv_i = 10.
    lv_r = |{ b( boolc( lv_x1 = 10 ) ) }{ b( boolc( lv_x1 = lv_i ) ) }{ b( boolc( lv_x2 = 256 ) ) }{ b( boolc( lv_x4 = -1 ) ) }{ b( boolc( lv_x1 < 11 ) ) }|.
    lv_x1 = 'FF'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = 255 ) ) }{ b( boolc( lv_x1 = -1 ) ) }|.
    rv = |xi:{ lv_r }|.
    lv_n = '0010'.
    lv_x1 = '0A'.
    lv_r = |{ b( boolc( lv_x1 = lv_n ) ) }|.
    rv = |{ rv } xn:{ lv_r }|.
    lv_xs = '0A'.
    lv_r = |{ b( boolc( lv_xs = 10 ) ) }{ b( boolc( lv_xs = lv_i ) ) }{ b( boolc( lv_xs = lv_n ) ) }|.
    rv = |{ rv } xsi:{ lv_r }|.
  ENDMETHOD.

  METHOD long.
    DATA lv_xs TYPE xstring.
    DATA lv_r TYPE string.
    lv_xs = 'FFFFFFFF'.
    lv_r = |{ b( boolc( lv_xs = -1 ) ) }|.
    lv_xs = 'FFFF'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = 65535 ) ) }|.
    CLEAR lv_xs.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = 0 ) ) }|.
    lv_xs = '0100000002'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = 2 ) ) }|.
    rv = |l:{ lv_r }|.
  ENDMETHOD.

  METHOD long2.
    DATA lv_x5 TYPE x LENGTH 5.
    DATA lv_r TYPE string.
    lv_x5 = '0100000002'.
    lv_r = |{ b( boolc( lv_x5 = 2 ) ) }|.
    lv_x5 = '00FFFFFFFF'.
    lv_r = |{ lv_r }{ b( boolc( lv_x5 = -1 ) ) }|.
    rv = |l2:{ lv_r }|.
  ENDMETHOD.
ENDCLASS.
