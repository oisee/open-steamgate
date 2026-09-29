CLASS zcl_gogen_t_strmove DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strmove IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_a,
             id     TYPE i,
             name   TYPE string,
             code   TYPE c LENGTH 3,
             only_a TYPE string,
             num    TYPE c LENGTH 4,
           END OF ty_a.
    TYPES: BEGIN OF ty_b,
             name   TYPE c LENGTH 3,
             id     TYPE string,
             code   TYPE string,
             only_b TYPE string,
             num    TYPE i,
           END OF ty_b.
    DATA a TYPE ty_a.
    DATA b TYPE ty_b.
    a-id = 42.
    a-name = `longname`.
    a-code = 'AB'.
    a-only_a = `x`.
    a-num = '12'.
    b-only_b = `keep`.
    FIND `z` IN `a`.
    MOVE-CORRESPONDING a TO b.
    rv = |[{ b-name }]/[{ b-id }]/[{ b-code }]/{ b-only_b }/{ b-num }/{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
