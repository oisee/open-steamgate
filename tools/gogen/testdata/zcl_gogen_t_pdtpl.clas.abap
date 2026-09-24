CLASS zcl_gogen_t_pdtpl DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdtpl IMPLEMENTATION.
  METHOD run.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p1 TYPE p LENGTH 8 DECIMALS 1.
    lv_p2 = '1.25'.
    lv_p1 = '0.5'.
    rv = |t:{ lv_p2 + 1 },{ lv_p2 - lv_p1 },{ - lv_p2 }|.
  ENDMETHOD.
ENDCLASS.
