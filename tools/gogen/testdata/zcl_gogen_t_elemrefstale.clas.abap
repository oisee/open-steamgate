CLASS zcl_gogen_t_elemrefstale DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_elemrefstale IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    DATA lr TYPE REF TO i.
    FIELD-SYMBOLS <row> TYPE any.
    v = 1.
    APPEND v TO lt.
    READ TABLE lt REFERENCE INTO lr WITH KEY table_line = 1.
    ASSIGN lr->* TO <row>.
    DELETE lt INDEX 1.
    <row> = 9.
    rv = `unreachable`.
  ENDMETHOD.
ENDCLASS.
