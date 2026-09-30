CLASS zcl_gogen_t_copyrows DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_std TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    TYPES ty_sort TYPE SORTED TABLE OF ty_row WITH UNIQUE KEY k.
ENDCLASS.

CLASS zcl_gogen_t_copyrows IMPLEMENTATION.
  METHOD run.
    DATA src TYPE ty_std.
    DATA dst TYPE ty_sort.
    DATA row TYPE ty_row.
    row-k = `b`. row-v = 1. APPEND row TO src.
    row-k = `a`. row-v = 2. APPEND row TO src.
    dst = src.
    READ TABLE dst ASSIGNING FIELD-SYMBOL(<d>) WITH KEY k = `b`.
    <d>-v = 9.
    READ TABLE src INTO row WITH KEY k = `b`.
    rv = |{ row-v }/|.
    READ TABLE src ASSIGNING FIELD-SYMBOL(<s>) WITH KEY k = `a`.
    <s>-v = 7.
    READ TABLE dst INTO row WITH KEY k = `a`.
    rv = |{ rv }{ row-v }|.
  ENDMETHOD.
ENDCLASS.
