CLASS zcl_gogen_t_copyinsert DEFINITION PUBLIC FINAL CREATE PUBLIC.
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

CLASS zcl_gogen_t_copyinsert IMPLEMENTATION.
  METHOD run.
    DATA src TYPE ty_std.
    DATA dst TYPE ty_sort.
    DATA row TYPE ty_row.
    row-k = `a`. row-v = 1. APPEND row TO src.
    INSERT LINES OF src INTO TABLE dst.
    READ TABLE dst ASSIGNING FIELD-SYMBOL(<d>) WITH KEY k = `a`.
    <d>-v = 9.
    READ TABLE src INDEX 1 INTO row.
    rv = |{ row-v }|.
  ENDMETHOD.
ENDCLASS.
