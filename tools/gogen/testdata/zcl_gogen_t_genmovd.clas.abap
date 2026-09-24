* A string or a c moved into generic data bound to a d or a t
* (parity-wave1: the CDS travel service's booking POST), beside the same
* move into the typed field. Run on A4H as written.
CLASS zcl_gogen_t_genmovd DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_genmovd IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = `1`.
    ELSE.
      rv = `0`.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA lv_d TYPE d.
    DATA lv_d2 TYPE d.
    DATA lv_t TYPE t.
    DATA lv_t2 TYPE t.
    DATA lt_s TYPE string_table.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 10.
    FIELD-SYMBOLS <v> TYPE any.
    APPEND `20250107` TO lt_s.
    APPEND `2025010` TO lt_s.
    APPEND `` TO lt_s.
    APPEND `abc` TO lt_s.
    APPEND `202501071234` TO lt_s.
    APPEND `2025-01-07` TO lt_s.
    APPEND ` 2025010` TO lt_s.
    rv = `d:`.
    ASSIGN lv_d TO <v>.
    LOOP AT lt_s INTO lv_s.
      <v> = lv_s.
      lv_d2 = lv_s.
      rv = |{ rv }[{ lv_d }]{ b( xsdbool( lv_d IS INITIAL ) ) }{ b( xsdbool( |{ lv_d }| = |{ lv_d2 }| ) ) }{ lv_d+0(4) }{ strlen( |{ lv_d }| ) },|.
    ENDLOOP.
    lv_c = '19991231'.
    <v> = lv_c.
    rv = |{ rv }c[{ lv_d }]|.
    rv = |{ rv } t:|.
    ASSIGN lv_t TO <v>.
    LOOP AT lt_s INTO lv_s.
      <v> = lv_s.
      lv_t2 = lv_s.
      rv = |{ rv }[{ lv_t }]{ b( xsdbool( lv_t IS INITIAL ) ) }{ b( xsdbool( |{ lv_t }| = |{ lv_t2 }| ) ) },|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
