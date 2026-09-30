CLASS zcl_gogen_t_delnoopbind DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.
CLASS zcl_gogen_t_delnoopbind IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    FIELD-SYMBOLS <row> TYPE i.
    v = 1. APPEND v TO lt.
    READ TABLE lt INDEX 1 ASSIGNING <row>.
    DELETE lt WHERE table_line = 9.
    <row> = 7.
    READ TABLE lt INDEX 1 INTO v.
    rv = |{ v }|.
  ENDMETHOD.
ENDCLASS.
