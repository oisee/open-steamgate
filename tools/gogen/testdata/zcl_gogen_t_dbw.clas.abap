* Database writes, measured on A4H 2026-09-23 (what semantics.mjs expects
* is in its EXPECT). Run there exactly as written, on a throwaway table of
* the same shape as zgogen_t_dbw.tabl.xml here; the note after each
* statement is "sy-subrc/sy-dbcnt".
CLASS zcl_gogen_t_dbw DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS note IMPORTING iv TYPE string CHANGING cv TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_dbw IMPLEMENTATION.
  METHOD note.
    DATA lv_s TYPE string.
    DATA lv_d TYPE string.
    lv_s = sy-subrc.
    lv_d = sy-dbcnt.
    cv = cv && iv && ':' && lv_s && '/' && lv_d && ` `.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE zgogen_t_dbw.
    DATA lt TYPE STANDARD TABLE OF zgogen_t_dbw WITH DEFAULT KEY.
    DATA lv_n TYPE i.
    DATA lv_s TYPE string.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `ins` CHANGING cv = rv ).
    ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `dup` CHANGING cv = rv ).
    CLEAR lt.
    ls-id = 'B'. ls-val = 3. APPEND ls TO lt.
    ls-id = 'A'. ls-val = 4. APPEND ls TO lt.
    ls-id = 'C'. ls-val = 5. APPEND ls TO lt.
    TRY.
        INSERT zgogen_t_dbw FROM TABLE lt.
        note( EXPORTING iv = `tab` CHANGING cv = rv ).
      CATCH cx_sy_open_sql_db.
        note( EXPORTING iv = `tabcx` CHANGING cv = rv ).
    ENDTRY.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    lv_s = lv_n.
    rv = rv && 'rows' && lv_s && ` `.
    CLEAR lt.
    ls-id = 'D'. ls-val = 6. APPEND ls TO lt.
    ls-id = 'A'. ls-val = 7. APPEND ls TO lt.
    ls-id = 'E'. ls-val = 8. APPEND ls TO lt.
    INSERT zgogen_t_dbw FROM TABLE lt ACCEPTING DUPLICATE KEYS.
    note( EXPORTING iv = `acc` CHANGING cv = rv ).
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    lv_s = lv_n.
    rv = rv && 'rows' && lv_s && ` `.
    ls-id = 'Z'. ls-val = 9.
    UPDATE zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `updmiss` CHANGING cv = rv ).
    ls-id = 'A'. ls-val = 10.
    UPDATE zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `upd` CHANGING cv = rv ).
    UPDATE zgogen_t_dbw SET val = 11 WHERE id = 'B' OR id = 'D'.
    note( EXPORTING iv = `set2` CHANGING cv = rv ).
    UPDATE zgogen_t_dbw SET val = 12 WHERE id = 'Q'.
    note( EXPORTING iv = `set0` CHANGING cv = rv ).
    CLEAR lt.
    ls-id = 'A'. ls-val = 13. APPEND ls TO lt.
    ls-id = 'Y'. ls-val = 14. APPEND ls TO lt.
    UPDATE zgogen_t_dbw FROM TABLE lt.
    note( EXPORTING iv = `updtab` CHANGING cv = rv ).
    ls-id = 'F'. ls-val = 15.
    MODIFY zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `modins` CHANGING cv = rv ).
    ls-val = 16.
    MODIFY zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `modupd` CHANGING cv = rv ).
    CLEAR lt.
    ls-id = 'F'. ls-val = 17. APPEND ls TO lt.
    ls-id = 'G'. ls-val = 18. APPEND ls TO lt.
    MODIFY zgogen_t_dbw FROM TABLE lt.
    note( EXPORTING iv = `modtab` CHANGING cv = rv ).
    ls-id = 'Q'.
    DELETE zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `delmiss` CHANGING cv = rv ).
    ls-id = 'G'.
    DELETE zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `del` CHANGING cv = rv ).
    DELETE FROM zgogen_t_dbw WHERE id = 'Q'.
    note( EXPORTING iv = `delw0` CHANGING cv = rv ).
    DELETE FROM zgogen_t_dbw WHERE id = 'B' OR id = 'C'.
    note( EXPORTING iv = `delw2` CHANGING cv = rv ).
    CLEAR lt.
    ls-id = 'D'. APPEND ls TO lt.
    ls-id = 'Q'. APPEND ls TO lt.
    DELETE zgogen_t_dbw FROM TABLE lt.
    note( EXPORTING iv = `deltab` CHANGING cv = rv ).
    ls-mandt = '999'. ls-id = 'M'. ls-val = 19.
    INSERT zgogen_t_dbw FROM ls.
    note( EXPORTING iv = `insm` CHANGING cv = rv ).
    SELECT SINGLE mandt FROM zgogen_t_dbw INTO lv_s WHERE id = 'M'.
    rv = rv && 'mandt' && lv_s && ` `.
    CLEAR lt.
    INSERT zgogen_t_dbw FROM TABLE lt.
    note( EXPORTING iv = `insempty` CHANGING cv = rv ).
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    lv_s = lv_n.
    rv = rv && 'rows' && lv_s && ` `.
    ROLLBACK WORK.
    note( EXPORTING iv = `rb` CHANGING cv = rv ).
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n.
    lv_s = lv_n.
    rv = rv && 'after' && lv_s.
  ENDMETHOD.
ENDCLASS.
