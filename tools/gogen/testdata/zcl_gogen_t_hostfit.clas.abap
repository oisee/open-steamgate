* A character host value that may not fit its CHAR10 column (a string, a
* c LENGTH 20) compared with it in WHERE and written by UPDATE ... SET:
* when it fits after its trailing blanks, it is bound right-trimmed and
* behaves as the c value would. Not an A4H value: the rule of the Go port
* (abap.DBCFit); what does not fit is refused, zcl_gogen_t_hostlong.
CLASS zcl_gogen_t_hostfit DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_hostfit IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_dbw.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 20.
    DATA lv_n TYPE i.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'AB'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    lv_s = `AB  `.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n WHERE id = lv_s.
    rv = |str:{ lv_n }|.
    lv_c = 'A'.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n WHERE id = lv_c.
    rv = rv && | c20:{ lv_n }|.
    lv_s = `ABCDEFGHIJ`.
    UPDATE zgogen_t_dbw SET id = lv_s WHERE id = lv_c.
    rv = rv && | set:{ sy-subrc }/{ sy-dbcnt }|.
    SELECT COUNT(*) FROM zgogen_t_dbw INTO lv_n WHERE id = lv_s.
    rv = rv && | ten:{ lv_n }|.
    DELETE FROM zgogen_t_dbw WHERE id = lv_s.
    rv = rv && | del:{ sy-subrc }/{ sy-dbcnt }|.
  ENDMETHOD.
ENDCLASS.
