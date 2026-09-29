* SELECT col COUNT( * ) / MAX( ) / MIN( ) / SUM( ) ... GROUP BY col INTO
* TABLE, by position and INTO CORRESPONDING FIELDS; sy-subrc and sy-dbcnt
* (A4H 2026-09-24, $ZOSG_TMP_0400)
CLASS zcl_gogen_t_grpby DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_grpby IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_g,
             val TYPE i,
             cnt TYPE i,
           END OF ty_g.
    TYPES: BEGIN OF ty_a,
             val TYPE i,
             mx  TYPE c LENGTH 10,
             mn  TYPE c LENGTH 10,
             sm  TYPE i,
           END OF ty_a.
    TYPES: BEGIN OF ty_r,
             cnt TYPE i,
             id  TYPE c LENGTH 10,
             val TYPE i,
           END OF ty_r.
    DATA lt_g TYPE STANDARD TABLE OF ty_g WITH DEFAULT KEY.
    DATA ls_g TYPE ty_g.
    DATA lt_a TYPE STANDARD TABLE OF ty_a WITH DEFAULT KEY.
    DATA ls_a TYPE ty_a.
    DATA lt_r TYPE STANDARD TABLE OF ty_r WITH DEFAULT KEY.
    DATA ls_r TYPE ty_r.
    DATA ls TYPE zgogen_t_dbw.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'AB'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'C'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'D'. ls-val = 3.
    INSERT zgogen_t_dbw FROM ls.
    SELECT val COUNT( * ) AS cnt FROM zgogen_t_dbw INTO TABLE lt_g GROUP BY val ORDER BY val.
    rv = |g:{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt_g INTO ls_g.
      rv = rv && |,{ ls_g-val }={ ls_g-cnt }|.
    ENDLOOP.
    SELECT val COUNT( * ) AS cnt FROM zgogen_t_dbw INTO TABLE lt_g WHERE id = 'Q' GROUP BY val.
    rv = rv && | g0:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt_g ) }|.
    SELECT COUNT( * ) AS cnt val FROM zgogen_t_dbw INTO CORRESPONDING FIELDS OF TABLE lt_g WHERE id <> 'A' GROUP BY val ORDER BY val DESCENDING.
    rv = rv && | cor:{ sy-dbcnt }|.
    LOOP AT lt_g INTO ls_g.
      rv = rv && |,{ ls_g-val }={ ls_g-cnt }|.
    ENDLOOP.
    SELECT val MAX( id ) AS mx MIN( id ) AS mn SUM( val ) AS sm FROM zgogen_t_dbw INTO TABLE lt_a GROUP BY val ORDER BY val.
    rv = rv && | agg:{ sy-dbcnt }|.
    LOOP AT lt_a INTO ls_a.
      rv = rv && |,{ ls_a-val }:{ ls_a-mx }/{ ls_a-mn }/{ ls_a-sm }|.
    ENDLOOP.
    SELECT COUNT( * ) id val FROM zgogen_t_dbw INTO TABLE lt_r WHERE val = 2 GROUP BY id val ORDER BY id.
    rv = rv && | two:{ sy-dbcnt }|.
    LOOP AT lt_r INTO ls_r.
      rv = rv && |,{ ls_r-id }{ ls_r-val }={ ls_r-cnt }|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
