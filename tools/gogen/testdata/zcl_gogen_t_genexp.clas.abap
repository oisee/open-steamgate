CLASS zcl_gogen_t_genexp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_dst,
             a TYPE i,
             b TYPE c LENGTH 3,
             c TYPE string,
           END OF ty_dst.
    TYPES: BEGIN OF ty_src,
             a TYPE string,
             b TYPE string,
             d TYPE i,
           END OF ty_src.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS set_a EXPORTING es_data TYPE any.
    CLASS-METHODS corr IMPORTING is_src TYPE ty_src EXPORTING es_data TYPE any.
    CLASS-METHODS clear_corr IMPORTING is_src TYPE ty_src EXPORTING es_data TYPE any.
ENDCLASS.

CLASS zcl_gogen_t_genexp IMPLEMENTATION.
  METHOD set_a.
    FIELD-SYMBOLS <lv> TYPE any.
    ASSIGN COMPONENT 'A' OF STRUCTURE es_data TO <lv>.
    <lv> = 5.
  ENDMETHOD.

  METHOD corr.
    MOVE-CORRESPONDING is_src TO es_data.
  ENDMETHOD.

  METHOD clear_corr.
    CLEAR es_data.
    MOVE-CORRESPONDING is_src TO es_data.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE ty_dst.
    DATA ls_src TYPE ty_src.
    ls-a = 1.
    ls-b = 'x'.
    ls-c = `keep`.
    set_a( IMPORTING es_data = ls ).
    rv = |set:{ ls-a }/{ ls-b }/{ ls-c }|.
    ls_src-a = `42`.
    ls_src-b = `hello`.
    ls_src-d = 9.
    corr( EXPORTING is_src = ls_src IMPORTING es_data = ls ).
    rv = |{ rv } corr:{ ls-a }/{ ls-b }/{ ls-c }|.
    clear_corr( EXPORTING is_src = ls_src IMPORTING es_data = ls ).
    rv = |{ rv } clear:{ ls-a }/{ ls-b }/[{ ls-c }]|.
  ENDMETHOD.
ENDCLASS.
