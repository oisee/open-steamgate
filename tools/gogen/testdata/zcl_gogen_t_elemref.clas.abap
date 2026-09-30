CLASS zcl_gogen_t_elemref DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_elemref IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    DATA first TYPE i.
    DATA lr TYPE REF TO i.
    FIELD-SYMBOLS <row> TYPE any.
    v = 1.
    APPEND v TO lt REFERENCE INTO lr.
    ASSIGN lr->* TO <row>.
    <row> = 9.
    READ TABLE lt INDEX 1 INTO first.
    v = 2.
    APPEND v TO lt.
    READ TABLE lt REFERENCE INTO lr WITH KEY table_line = 2.
    ASSIGN lr->* TO <row>.
    <row> = 8.
    READ TABLE lt INDEX 2 INTO v.
    rv = |append:{ first } read:{ v }|.
  ENDMETHOD.
ENDCLASS.
