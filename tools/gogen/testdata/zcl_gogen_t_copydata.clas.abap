CLASS zcl_gogen_t_copydata DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_copydata IMPLEMENTATION.
  METHOD run.
    DATA src TYPE ty_tab.
    DATA dst TYPE ty_tab.
    DATA row TYPE ty_row.
    FIELD-SYMBOLS <g> TYPE ANY TABLE.
    row-k = `a`. row-v = 1. APPEND row TO src.
    ASSIGN dst TO <g>.
    MOVE src TO <g>.
    READ TABLE dst INDEX 1 ASSIGNING FIELD-SYMBOL(<d>).
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ row-v }|.
  ENDMETHOD.
ENDCLASS.
