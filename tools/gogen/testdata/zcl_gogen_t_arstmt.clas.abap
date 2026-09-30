CLASS zcl_gogen_t_arstmt DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_arstmt IMPLEMENTATION.
  METHOD run.
    DATA lv_i TYPE i VALUE 10.
    DATA lv_p TYPE p LENGTH 8 DECIMALS 2 VALUE '10.00'.
    ADD 2 TO lv_i.
    SUBTRACT 5 FROM lv_i.
    MULTIPLY lv_i BY 3.
    DIVIDE lv_i BY 2.
    ADD '2.25' TO lv_p.
    SUBTRACT 1 FROM lv_p.
    MULTIPLY lv_p BY 2.
    DIVIDE lv_p BY 2.
    rv = |i:{ lv_i } p:{ lv_p }|.
  ENDMETHOD.
ENDCLASS.
