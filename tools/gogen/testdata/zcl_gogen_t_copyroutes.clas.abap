CLASS zcl_gogen_t_copyroutes DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS by_value IMPORTING VALUE(it) TYPE ty_tab RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_copyroutes IMPLEMENTATION.
  METHOD by_value.
    READ TABLE it INDEX 1 ASSIGNING FIELD-SYMBOL(<row>).
    <row>-v = 9.
    READ TABLE it INDEX 1 INTO DATA(ls).
    rv = ls-v.
  ENDMETHOD.
  METHOD run.
    DATA src TYPE ty_tab.
    DATA dst TYPE ty_tab.
    DATA row TYPE ty_row.
    row-k = `a`. row-v = 1. APPEND row TO src.
    dst = src.
    READ TABLE dst INDEX 1 ASSIGNING FIELD-SYMBOL(<d>).
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ row-v }|.
    CLEAR dst.
    MOVE src TO dst.
    READ TABLE dst INDEX 1 ASSIGNING <d>.
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ rv }{ row-v }|.
    CLEAR dst.
    APPEND LINES OF src TO dst.
    READ TABLE dst INDEX 1 ASSIGNING <d>.
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ rv }{ row-v }|.
    dst = CORRESPONDING ty_tab( src ).
    READ TABLE dst INDEX 1 ASSIGNING <d>.
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ rv }{ row-v }|.
    DATA n TYPE i.
    n = by_value( src ).
    READ TABLE src INDEX 1 INTO row.
    rv = |{ rv }{ row-v }{ n }|.
  ENDMETHOD.
ENDCLASS.
