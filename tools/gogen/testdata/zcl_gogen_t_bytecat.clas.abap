CLASS zcl_gogen_t_bytecat DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS lc_x TYPE x LENGTH 4 VALUE 'AB00CD00'.
    CONSTANTS lc_ff TYPE x LENGTH 1 VALUE 'FF'.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_bytecat IMPLEMENTATION.
  METHOD run.
    DATA lv_x TYPE x LENGTH 4.
    DATA lv_y TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lv_e TYPE xstring.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_i TYPE i.
    lv_x = lc_x.
    lv_xs = lc_ff.
    READ TABLE lt_i INTO lv_i INDEX 1.
    CONCATENATE lv_xs lv_x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |cat:{ lv_xs }/{ lv_i }/{ sy-subrc }|.
    CLEAR lv_xs.
    CONCATENATE lv_xs lv_y lv_x lv_e INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } zeros:{ lv_xs }/{ lv_i }|.
    CONCATENATE lv_e lv_e INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } empty:{ lv_i }/{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
