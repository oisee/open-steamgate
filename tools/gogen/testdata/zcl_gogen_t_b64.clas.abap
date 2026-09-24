CLASS zcl_gogen_t_b64 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS lc_ff TYPE x LENGTH 1 VALUE 'FF'.
    CONSTANTS lc_fffe TYPE x LENGTH 2 VALUE 'FFFE'.
    CONSTANTS lc_fbffbf TYPE x LENGTH 3 VALUE 'FBFFBF'.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_b64 IMPLEMENTATION.
  METHOD run.
    DATA lv_xs TYPE xstring.
    DATA lv_e TYPE xstring.
    DATA lv_s TYPE string.
    lv_xs = lc_ff.
    lv_s = cl_http_utility=>encode_x_base64( lv_xs ).
    rv = |b1:{ lv_s }|.
    lv_xs = lc_fffe.
    lv_s = cl_http_utility=>encode_x_base64( lv_xs ).
    rv = |{ rv } b2:{ lv_s }|.
    lv_xs = lc_fbffbf.
    lv_s = cl_http_utility=>encode_x_base64( lv_xs ).
    rv = |{ rv } b3:{ lv_s }|.
    lv_s = cl_http_utility=>encode_x_base64( lv_e ).
    rv = |{ rv } b0:[{ lv_s }]|.
  ENDMETHOD.
ENDCLASS.
