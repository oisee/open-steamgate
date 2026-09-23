* sy-subrc and sy-dbcnt after SELECT, measured on A4H 2026-09-23 with the
* same statements over a system table of two rows (probe ZCL_GOGEN_T_CNT in
* $ZOSG_TMP_0220, deleted after): COUNT(*) puts the count into sy-dbcnt and
* is sy-subrc 4 when it is 0; INTO TABLE 0/rows or 4/0; SINGLE 0/1 or 4/0;
* APPEND leaves sy-subrc alone. Here the same over zgogen_t_dbw with two
* rows, and ranges (their rules pinned by the pairs of tools/ir-ranges.mjs:
* a value longer than the column is CX_SY_OPEN_SQL_DATA_ERROR, a subclass
* of CX_SY_OPEN_SQL_ERROR on A4H).
CLASS zcl_gogen_t_selcnt DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_selcnt IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_range,
             sign   TYPE c LENGTH 1,
             option TYPE c LENGTH 2,
             low    TYPE c LENGTH 10,
             high   TYPE c LENGTH 10,
           END OF ty_range.
    DATA ls TYPE zgogen_t_dbw.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv TYPE i.
    DATA lv_n TYPE i.
    DATA lt_id TYPE STANDARD TABLE OF zgogen_t_dbw-id WITH DEFAULT KEY.
    DATA lv_id TYPE zgogen_t_dbw-id.
    DATA lr TYPE STANDARD TABLE OF ty_range WITH DEFAULT KEY.
    DATA ls_r TYPE ty_range.
    TYPES: BEGIN OF ty_range2,
             sign   TYPE c LENGTH 1,
             option TYPE c LENGTH 2,
             low    TYPE c LENGTH 20,
             high   TYPE c LENGTH 20,
           END OF ty_range2.
    DATA lr2 TYPE STANDARD TABLE OF ty_range2 WITH DEFAULT KEY.
    DATA ls_r2 TYPE ty_range2.
    DATA lv_s TYPE string.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'AB'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 3.
    INSERT zgogen_t_dbw FROM ls.
    READ TABLE lt INDEX 1 INTO lv.
    APPEND 1 TO lt.
    rv = |app:{ sy-subrc }|.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n WHERE id = 'Q'.
    rv = rv && | cnt0:{ sy-subrc }/{ sy-dbcnt }/{ lv_n }|.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    rv = rv && | cnt:{ sy-subrc }/{ sy-dbcnt }/{ lv_n }|.
    SELECT id FROM zgogen_t_dbw INTO TABLE lt_id.
    rv = rv && | tab:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt_id ) }|.
    SELECT id FROM zgogen_t_dbw INTO TABLE lt_id WHERE id = 'Q'.
    rv = rv && | tab0:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt_id ) }|.
    SELECT SINGLE id FROM zgogen_t_dbw INTO lv_id WHERE id = 'B'.
    rv = rv && | single:{ sy-subrc }/{ sy-dbcnt }|.
    SELECT SINGLE id FROM zgogen_t_dbw INTO lv_id WHERE id = 'Q'.
    rv = rv && | single0:{ sy-subrc }/{ sy-dbcnt }|.
    ls_r-sign = 'I'. ls_r-option = 'CP'. ls_r-low = 'A*'. APPEND ls_r TO lr.
    ls_r-sign = 'E'. ls_r-option = 'EQ'. ls_r-low = 'AB'. APPEND ls_r TO lr.
    SELECT id FROM zgogen_t_dbw INTO TABLE lt_id WHERE id IN lr ORDER BY id.
    rv = rv && | rng:{ sy-dbcnt }|.
    LOOP AT lt_id INTO lv_id.
      lv_s = lv_id.
      rv = rv && `,` && lv_s.
    ENDLOOP.
    CLEAR lr2.
    ls_r2-sign = 'I'. ls_r2-option = 'EQ'. ls_r2-low = 'ABCDEFGHIJK'. APPEND ls_r2 TO lr2.
    TRY.
        SELECT id FROM zgogen_t_dbw INTO TABLE lt_id WHERE id IN lr2.
        rv = rv && | long:none|.
      CATCH cx_sy_open_sql_error.
        rv = rv && | long:caught|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
