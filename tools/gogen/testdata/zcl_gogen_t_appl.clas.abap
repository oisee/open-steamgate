* APPEND LINES OF itab [FROM i] [TO j] TO itab: the rows appended in order,
* FROM / TO clamped to the source; sy-subrc and sy-tabix as A4H leaves them
* (measured 2026-09-24, $ZOSG_TMP_0400); rows of another type converted
CLASS zcl_gogen_t_appl DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_it TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    CLASS-METHODS three RETURNING VALUE(rt) TYPE ty_it.
    CLASS-METHODS show IMPORTING it TYPE ty_it RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_appl IMPLEMENTATION.
  METHOD three.
    APPEND 7 TO rt.
    APPEND 8 TO rt.
    APPEND 9 TO rt.
  ENDMETHOD.

  METHOD show.
    DATA lv TYPE i.
    LOOP AT it INTO lv.
      rv = rv && |{ lv };|.
    ENDLOOP.
    rv = |[{ rv }]|.
  ENDMETHOD.

  METHOD run.
    DATA lt_a TYPE ty_it.
    DATA lt_b TYPE ty_it.
    DATA lt_e TYPE ty_it.
    DATA lv TYPE i.
    DATA lv_rc TYPE i.
    DATA lv_tx TYPE i.
    TYPES ty_c3 TYPE c LENGTH 3.
    DATA lt_c TYPE STANDARD TABLE OF ty_c3 WITH DEFAULT KEY.
    DATA lt_s TYPE string_table.
    DATA lv_s TYPE string.
    DO 5 TIMES.
      APPEND sy-index TO lt_a.
    ENDDO.
    APPEND 0 TO lt_b.
    READ TABLE lt_a INTO lv INDEX 2.
    READ TABLE lt_a INTO lv INDEX 99.
    APPEND LINES OF lt_a TO lt_b.
    lv_rc = sy-subrc.
    lv_tx = sy-tabix.
    rv = |all:{ lv_rc }/{ lv_tx }{ show( lt_b ) }|.
    CLEAR lt_b.
    READ TABLE lt_a INTO lv INDEX 99.
    APPEND LINES OF lt_a FROM 2 TO 4 TO lt_b.
    lv_rc = sy-subrc.
    lv_tx = sy-tabix.
    rv = rv && | ft:{ lv_rc }/{ lv_tx }{ show( lt_b ) }|.
    CLEAR lt_b.
    APPEND LINES OF lt_a FROM 4 TO lt_b.
    rv = rv && | f:{ show( lt_b ) }|.
    CLEAR lt_b.
    APPEND LINES OF lt_a TO 2 TO lt_b.
    rv = rv && | t:{ show( lt_b ) }|.
    CLEAR lt_b.
    READ TABLE lt_a INTO lv INDEX 3.
    APPEND LINES OF lt_a FROM 4 TO 2 TO lt_b.
    lv_rc = sy-subrc.
    lv_tx = sy-tabix.
    rv = rv && | rev:{ lv_rc }/{ lv_tx }{ show( lt_b ) }|.
    APPEND LINES OF lt_a FROM 9 TO lt_b.
    rv = rv && | past:{ show( lt_b ) }|.
    APPEND LINES OF lt_a FROM 3 TO 99 TO lt_b.
    rv = rv && | clamp:{ show( lt_b ) }|.
    READ TABLE lt_a INTO lv INDEX 99.
    APPEND LINES OF lt_e TO lt_b.
    lv_rc = sy-subrc.
    lv_tx = sy-tabix.
    rv = rv && | empty:{ lv_rc }/{ lv_tx }{ show( lt_b ) }|.
    APPEND LINES OF three( ) TO lt_b.
    rv = rv && | call:{ sy-tabix }{ show( lt_b ) }|.
    APPEND 'ab' TO lt_c.
    APPEND 'xyz' TO lt_c.
    APPEND `q ` TO lt_s.
    APPEND LINES OF lt_c TO lt_s.
    LOOP AT lt_s INTO lv_s.
      rv = rv && |<{ lv_s }>|.
    ENDLOOP.
    APPEND LINES OF lt_a TO lt_a.
    rv = rv && | self:{ show( lt_a ) }|.
  ENDMETHOD.
ENDCLASS.
