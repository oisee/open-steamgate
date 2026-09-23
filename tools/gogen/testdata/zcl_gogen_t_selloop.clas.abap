* SELECT ... ENDSELECT, measured on A4H 2026-09-24: this class over
* ZGOGEN_T_DBW ($ZOSG_TMP_0195, deleted after), and the same statements over
* T000 of two clients. Each pass starts with sy-subrc 0 and sy-dbcnt the rows
* so far; after the loop, EXIT too, 0 and the rows read even when the body
* left sy-subrc 4; no row: 4/0 and the work area kept.
CLASS zcl_gogen_t_selloop DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_selloop IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_two,
             x  TYPE i,
             id TYPE zgogen_t_dbw-id,
           END OF ty_two.
    DATA ls TYPE zgogen_t_dbw.
    DATA ls2 TYPE ty_two.
    DATA lv_id TYPE zgogen_t_dbw-id.
    DATA lv_n TYPE i.
    DATA lv TYPE i.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    rv = |n:{ lv_n } in:|.
    SELECT * FROM zgogen_t_dbw INTO ls ORDER BY id.
      rv = rv && |{ sy-dbcnt }/{ sy-subrc },|.
      READ TABLE lt INDEX 1 INTO lv.
    ENDSELECT.
    rv = rv && | after:{ sy-subrc }/{ sy-dbcnt }|.
    SELECT * FROM zgogen_t_dbw INTO ls ORDER BY id.
      EXIT.
    ENDSELECT.
    rv = rv && | exit:{ sy-subrc }/{ sy-dbcnt }/{ ls-id }|.
    SELECT * FROM zgogen_t_dbw INTO ls.
      READ TABLE lt INDEX 1 INTO lv.
      EXIT.
    ENDSELECT.
    rv = rv && | exitmiss:{ sy-subrc }/{ sy-dbcnt }|.
    ls-id = 'QQQ'.
    SELECT * FROM zgogen_t_dbw INTO ls WHERE id = 'ZZZ'.
      rv = rv && |body!|.
    ENDSELECT.
    rv = rv && | none:{ sy-subrc }/{ sy-dbcnt }/{ ls-id }|.
    lv = 0.
    SELECT * FROM zgogen_t_dbw INTO ls.
      lv = lv + 1.
      CONTINUE.
    ENDSELECT.
    rv = rv && | cont:{ sy-subrc }/{ sy-dbcnt }/{ lv }|.
    ls2-x = 5.
    SELECT id FROM zgogen_t_dbw INTO CORRESPONDING FIELDS OF ls2 ORDER BY id.
      EXIT.
    ENDSELECT.
    rv = rv && | corr:{ ls2-x }/{ ls2-id }|.
    SELECT id FROM zgogen_t_dbw INTO lv_id ORDER BY id DESCENDING.
    ENDSELECT.
    rv = rv && | elem:{ lv_id }/{ sy-dbcnt }|.
    lv = 0.
    SELECT * FROM zgogen_t_dbw INTO ls ORDER BY id.
      lv = lv + 1.
      IF lv = 2.
        EXIT.
      ENDIF.
    ENDSELECT.
    rv = rv && | exit2:{ sy-subrc }/{ sy-dbcnt }|.
  ENDMETHOD.
ENDCLASS.
