* DELETE itab (the current row) inside LOOP ... ASSIGNING <l>: what <l> is
* after its row went was not measured on A4H, so a later use of <l> is
* refused (NOT_COMPILED); a fresh LOOP ... ASSIGNING <l> after it compiles.
CLASS zcl_gogen_t_delfs DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty, v TYPE string, END OF ty.
    TYPES tt TYPE STANDARD TABLE OF ty WITH DEFAULT KEY.
    CLASS-METHODS fill RETURNING VALUE(rt) TYPE tt.
    CLASS-METHODS fresh RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS stale RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_delfs IMPLEMENTATION.
  METHOD run.
    rv = fresh( ) && `/` && stale( ).
  ENDMETHOD.
  METHOD fill.
    DATA ls TYPE ty.
    ls-v = `a`. APPEND ls TO rt. ls-v = `b`. APPEND ls TO rt. ls-v = `c`. APPEND ls TO rt.
  ENDMETHOD.
  METHOD fresh.
    DATA lt TYPE tt.
    FIELD-SYMBOLS <l> TYPE ty.
    lt = fill( ).
    LOOP AT lt ASSIGNING <l>.
      IF <l>-v = `b`.
        DELETE lt.
      ENDIF.
    ENDLOOP.
    LOOP AT lt ASSIGNING <l>.
      rv = rv && <l>-v.
    ENDLOOP.
  ENDMETHOD.
  METHOD stale.
    DATA lt TYPE tt.
    FIELD-SYMBOLS <l> TYPE ty.
    lt = fill( ).
    LOOP AT lt ASSIGNING <l>.
      DELETE lt.
      rv = rv && <l>-v.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
