CLASS zcl_gogen_t_copyhash DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE HASHED TABLE OF ty_row WITH UNIQUE KEY k.
ENDCLASS.

CLASS zcl_gogen_t_copyhash IMPLEMENTATION.
  METHOD run.
    DATA src TYPE ty_tab.
    DATA dst TYPE ty_tab.
    DATA row TYPE ty_row.
    row-k = `a`. row-v = 1. INSERT row INTO TABLE src.
    dst = src.
    READ TABLE dst ASSIGNING FIELD-SYMBOL(<d>) WITH TABLE KEY k = `a`.
    <d>-v = 9.
    READ TABLE src INTO row WITH TABLE KEY k = `a`.
    rv = |{ row-v }|.
  ENDMETHOD.
ENDCLASS.
