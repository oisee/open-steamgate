CLASS zcl_gogen_t_fmdefault DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_fmdefault IMPLEMENTATION.
  METHOD run.
    DATA lv_n TYPE i.
    CALL FUNCTION 'ZGOGEN_T_DEF' IMPORTING ev_n = lv_n.
    rv = |{ lv_n }|.
    CALL FUNCTION 'ZGOGEN_T_DEF' EXPORTING iv_n = 9 IMPORTING ev_n = lv_n.
    rv = |{ rv }/{ lv_n }|.
  ENDMETHOD.
ENDCLASS.
