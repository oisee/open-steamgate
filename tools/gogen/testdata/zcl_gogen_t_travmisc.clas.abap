CLASS zcl_gogen_t_travmisc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS co_x TYPE string VALUE `dx`.
    CONSTANTS co_n TYPE i VALUE 7.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_a,
             a TYPE c LENGTH 2,
             b TYPE i,
             c TYPE c LENGTH 3,
           END OF ty_a.
    TYPES: BEGIN OF ty_b,
             x TYPE c LENGTH 2,
             y TYPE i,
             z TYPE c LENGTH 3,
           END OF ty_b.
    CLASS-METHODS dflt IMPORTING iv TYPE string DEFAULT co_x
                                 in TYPE i DEFAULT zcl_gogen_t_travmisc=>co_n
                       RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_travmisc IMPLEMENTATION.
  METHOD dflt.
    rv = |{ iv }/{ in }|.
  ENDMETHOD.

  METHOD run.
    DATA ls_a TYPE ty_a.
    DATA ls_b TYPE ty_b.
    ls_a-a = 'pq'.
    ls_a-b = 42.
    ls_a-c = 'rst'.
    ls_b = ls_a.
    rv = |move:{ ls_b-x }/{ ls_b-y }/{ ls_b-z }|.
    ls_b-y = 5.
    ls_a = ls_b.
    rv = |{ rv } back:{ ls_a-a }/{ ls_a-b }/{ ls_a-c }|.
    rv = |{ rv } dflt:{ dflt( ) } { dflt( iv = `v` ) } { dflt( in = 1 ) }|.
  ENDMETHOD.
ENDCLASS.
