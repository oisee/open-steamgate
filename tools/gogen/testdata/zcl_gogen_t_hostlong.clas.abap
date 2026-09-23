* DELETE FROM ... WHERE id = host with a host value longer than the CHAR10
* column. Cut to the column it would be 'ABCDEFGHIJ' and delete that row;
* A4H raises CX_SY_OPEN_SQL_DATA_ERROR for such a value as a range LOW
* (a4h-ranges.json), the plain comparison is not measured, so the Go port
* refuses it when it arrives (NOT_COMPILED) instead of cutting it.
CLASS zcl_gogen_t_hostlong DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_hostlong IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_dbw.
    DATA lv_s TYPE string.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'ABCDEFGHIJ'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    lv_s = `ABCDEFGHIJK`.
    DELETE FROM zgogen_t_dbw WHERE id = lv_s.
    rv = |del:{ sy-subrc }/{ sy-dbcnt }|.
  ENDMETHOD.
ENDCLASS.
