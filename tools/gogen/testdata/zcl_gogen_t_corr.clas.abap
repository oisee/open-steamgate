CLASS zcl_gogen_t_corr DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_a,
             id    TYPE i,
             name  TYPE c LENGTH 6,
             extra TYPE string,
           END OF ty_a.
    TYPES: BEGIN OF ty_b,
             name  TYPE string,
             id    TYPE n LENGTH 4,
             other TYPE c LENGTH 2,
           END OF ty_b.
    TYPES tt_a TYPE STANDARD TABLE OF ty_a WITH DEFAULT KEY.
    TYPES tt_b TYPE STANDARD TABLE OF ty_b WITH DEFAULT KEY.
    TYPES tt_c TYPE STANDARD TABLE OF char4 WITH DEFAULT KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

* table CORRESPONDING and table comparison (the report converter of
* open-abap-gui writes both for a select-option); measured on A4H 2026-09-30
CLASS zcl_gogen_t_corr IMPLEMENTATION.
  METHOD run.
    DATA lt_a TYPE tt_a.
    DATA ls_a TYPE ty_a.
    DATA lt_b TYPE tt_b.
    DATA lt_b2 TYPE tt_b.
    DATA lt_empty TYPE tt_a.
    DATA ls_b TYPE ty_b.
    DATA lt_c1 TYPE tt_c.
    DATA lt_c2 TYPE tt_c.
    ls_a-id = 7.
    ls_a-name = 'ab'.
    ls_a-extra = `x`.
    APPEND ls_a TO lt_a.
    ls_a-id = 1234.
    ls_a-name = 'abcdef'.
    ls_a-extra = `y`.
    APPEND ls_a TO lt_a.
    lt_b = CORRESPONDING #( lt_a ).
    LOOP AT lt_b INTO ls_b.
      rv = |{ rv }[{ ls_b-name }/{ ls_b-id }/{ ls_b-other }]|.
    ENDLOOP.
    lt_b = CORRESPONDING tt_b( lt_empty ).
    rv = |{ rv } empty:{ lines( lt_b ) }|.
    lt_b = CORRESPONDING #( lt_a ).
    lt_b2 = lt_b.
    IF lt_b = lt_b2.
      rv = rv && ` copy:eq`.
    ELSE.
      rv = rv && ` copy:ne`.
    ENDIF.
    ls_b-other = 'z'.
    MODIFY lt_b2 FROM ls_b INDEX 1.
    IF lt_b <> lt_b2.
      rv = rv && ` changed:ne`.
    ELSE.
      rv = rv && ` changed:eq`.
    ENDIF.
    lt_b2 = lt_b.
    DELETE lt_b2 INDEX 2.
    IF lt_b = lt_b2.
      rv = rv && ` shorter:eq`.
    ELSE.
      rv = rv && ` shorter:ne`.
    ENDIF.
    CLEAR lt_b2.
    LOOP AT lt_b INTO ls_b.
      INSERT ls_b INTO lt_b2 INDEX 1.
    ENDLOOP.
    IF lt_b = lt_b2.
      rv = rv && ` reversed:eq`.
    ELSE.
      rv = rv && ` reversed:ne`.
    ENDIF.
    APPEND 'ab' TO lt_c1.
    APPEND 'ab  ' TO lt_c2.
    IF lt_c1 = lt_c2.
      rv = rv && ` blanks:eq`.
    ELSE.
      rv = rv && ` blanks:ne`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
