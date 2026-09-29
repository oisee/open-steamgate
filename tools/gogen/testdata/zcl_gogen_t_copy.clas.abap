CLASS zcl_gogen_t_copy DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES tt TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    TYPES: BEGIN OF ty_s, n TYPE i, t TYPE tt, END OF ty_s.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS alias IMPORTING it TYPE tt CHANGING ct TYPE tt RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_copy IMPLEMENTATION.
  METHOD alias.
    MODIFY ct INDEX 1 FROM 99.
    APPEND 7 TO ct.
    rv = |it:{ lines( it ) },{ it[ 1 ] }|.
  ENDMETHOD.
  METHOD run.
    DATA lt_a TYPE tt.
    DATA lt_b TYPE tt.
    DATA ls_a TYPE ty_s.
    DATA ls_b TYPE ty_s.
    lt_a = VALUE #( ( 1 ) ( 2 ) ).
    lt_b = lt_a.
    MODIFY lt_b INDEX 1 FROM 50.
    APPEND 3 TO lt_b.
    rv = |copy a:{ lines( lt_a ) },{ lt_a[ 1 ] } b:{ lines( lt_b ) },{ lt_b[ 1 ] }|.
    ls_a-t = VALUE #( ( 1 ) ( 2 ) ).
    ls_b = ls_a.
    MODIFY ls_b-t INDEX 1 FROM 60.
    rv = rv && | struct a:{ ls_a-t[ 1 ] } b:{ ls_b-t[ 1 ] }|.
    lt_a = VALUE #( ( 1 ) ( 2 ) ).
    rv = rv && | alias { alias( EXPORTING it = lt_a CHANGING ct = lt_a ) } after:{ lines( lt_a ) },{ lt_a[ 1 ] }|.
  ENDMETHOD.
ENDCLASS.
