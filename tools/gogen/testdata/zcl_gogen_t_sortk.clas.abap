* SORT itab without BY sorts by the primary key: for elementary rows the
* line, for a structure WITH DEFAULT KEY the character-like and byte-like
* components; DESCENDING; STABLE BY keeps the order of equal keys; mixed
* directions (A4H 2026-09-24, $ZOSG_TMP_0400)
CLASS zcl_gogen_t_sortk DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             name TYPE c LENGTH 2,
             n    TYPE i,
             s    TYPE string,
           END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS rows IMPORTING it TYPE ty_rows RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS add IMPORTING iv_name TYPE c iv_n TYPE i iv_s TYPE string CHANGING ct TYPE ty_rows.
ENDCLASS.

CLASS zcl_gogen_t_sortk IMPLEMENTATION.
  METHOD rows.
    DATA ls TYPE ty_row.
    LOOP AT it INTO ls.
      rv = rv && |{ ls-name }{ ls-n }{ ls-s };|.
    ENDLOOP.
  ENDMETHOD.

  METHOD add.
    DATA ls TYPE ty_row.
    ls-name = iv_name.
    ls-n = iv_n.
    ls-s = iv_s.
    APPEND ls TO ct.
  ENDMETHOD.

  METHOD run.
    DATA lt_s TYPE string_table.
    TYPES ty_c3 TYPE c LENGTH 3.
    DATA lt_c TYPE STANDARD TABLE OF ty_c3 WITH DEFAULT KEY.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lt_r TYPE ty_rows.
    DATA lv_s TYPE string.
    DATA lv_c TYPE ty_c3.
    DATA lv_i TYPE i.
    APPEND `b` TO lt_s.
    APPEND `a` TO lt_s.
    APPEND `C` TO lt_s.
    APPEND `` TO lt_s.
    APPEND `a ` TO lt_s.
    APPEND `B` TO lt_s.
    SORT lt_s.
    rv = `s:`.
    LOOP AT lt_s INTO lv_s.
      rv = rv && |<{ lv_s }>|.
    ENDLOOP.
    SORT lt_s DESCENDING.
    rv = rv && ` sd:`.
    LOOP AT lt_s INTO lv_s.
      rv = rv && |<{ lv_s }>|.
    ENDLOOP.
    APPEND 'b' TO lt_c.
    APPEND 'a' TO lt_c.
    APPEND 'C' TO lt_c.
    APPEND '' TO lt_c.
    APPEND 'ab' TO lt_c.
    SORT lt_c.
    rv = rv && ` c:`.
    LOOP AT lt_c INTO lv_c.
      rv = rv && |<{ lv_c }>|.
    ENDLOOP.
    APPEND 3 TO lt_i.
    APPEND -1 TO lt_i.
    APPEND 2 TO lt_i.
    SORT lt_i.
    rv = rv && ` i:`.
    LOOP AT lt_i INTO lv_i.
      rv = rv && |{ lv_i };|.
    ENDLOOP.
    add( EXPORTING iv_name = 'b' iv_n = 1 iv_s = `x` CHANGING ct = lt_r ).
    add( EXPORTING iv_name = 'a' iv_n = 5 iv_s = `y` CHANGING ct = lt_r ).
    add( EXPORTING iv_name = 'a' iv_n = 4 iv_s = `y` CHANGING ct = lt_r ).
    add( EXPORTING iv_name = 'a' iv_n = 3 iv_s = `y` CHANGING ct = lt_r ).
    add( EXPORTING iv_name = 'a' iv_n = 9 iv_s = `a` CHANGING ct = lt_r ).
    add( EXPORTING iv_name = 'A' iv_n = 2 iv_s = `z` CHANGING ct = lt_r ).
    SORT lt_r STABLE BY name.
    rv = rv && | st:{ rows( lt_r ) }|.
    SORT lt_r BY name DESCENDING n.
    rv = rv && | mix:{ rows( lt_r ) }|.
    SORT lt_r.
    rv = rv && | key:{ rows( lt_r ) }|.
  ENDMETHOD.
ENDCLASS.
