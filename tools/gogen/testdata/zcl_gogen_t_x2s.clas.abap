CLASS zcl_gogen_t_x2s DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS lc_dead TYPE x LENGTH 4 VALUE 'DEADBEEF'.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS hex1 IMPORTING iv_int TYPE i RETURNING VALUE(rv_hex) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_x2s IMPLEMENTATION.
  METHOD hex1.
    DATA lv_hex TYPE x LENGTH 1.
    lv_hex = iv_int.
    rv_hex = lv_hex.
  ENDMETHOD.
  METHOD run.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lv_s TYPE string.
    DATA lv_c3 TYPE c LENGTH 3.
    rv = |a:{ hex1( 171 ) } b:{ hex1( 0 ) } c:{ hex1( 300 ) } d:{ hex1( 255 ) }|.
    lv_x2 = 2571.
    lv_s = lv_x2.
    rv = |{ rv } e:[{ lv_s }]|.
    lv_xs = lc_dead.
    lv_s = lv_xs.
    rv = |{ rv } f:[{ lv_s }]|.
    CLEAR lv_xs.
    lv_s = lv_xs.
    rv = |{ rv } g:[{ lv_s }]|.
    lv_c3 = lv_x2.
    rv = |{ rv } h:[{ lv_c3 }]|.
    rv = |{ rv } i:{ hex1( -1 ) }|.
  ENDMETHOD.
ENDCLASS.
