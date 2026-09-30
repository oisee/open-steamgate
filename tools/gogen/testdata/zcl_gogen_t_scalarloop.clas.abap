CLASS zcl_gogen_t_scalarloop DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_scalarloop IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    FIELD-SYMBOLS <row> TYPE i.
    v = 1. APPEND v TO lt.
    v = 2. APPEND v TO lt.
    LOOP AT lt ASSIGNING <row>.
      EXIT.
    ENDLOOP.
    DELETE lt INDEX 1.
    v = <row>.
    rv = |{ v }|.
  ENDMETHOD.
ENDCLASS.
