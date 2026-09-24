* A table of strings and a table of c passed as a generic table: each row
* keeps its own type (ultra/events: in Go both are []string and shared one
* descriptor, so the c rows read as strings in whichever came second).
CLASS zcl_gogen_t_desckey DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_c3 TYPE c LENGTH 3.
    TYPES ty_c3_tab TYPE STANDARD TABLE OF ty_c3 WITH DEFAULT KEY.
    CLASS-METHODS kind IMPORTING it TYPE STANDARD TABLE RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_desckey IMPLEMENTATION.
  METHOD kind.
    DATA lv_kind TYPE c LENGTH 1.
    FIELD-SYMBOLS <l> TYPE any.
    LOOP AT it ASSIGNING <l>.
      DESCRIBE FIELD <l> TYPE lv_kind.
      rv = rv && lv_kind.
    ENDLOOP.
  ENDMETHOD.

  METHOD run.
    DATA lt_s TYPE string_table.
    DATA lt_c TYPE ty_c3_tab.
    APPEND `a` TO lt_s.
    APPEND 'b' TO lt_c.
    rv = |{ kind( lt_s ) } { kind( lt_c ) }|.
  ENDMETHOD.
ENDCLASS.
