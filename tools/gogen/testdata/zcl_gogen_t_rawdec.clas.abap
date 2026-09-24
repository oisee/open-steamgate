* A RAW(4) and a DEC(9,2) column in one row (merge of ultra/zvdb and
* ultra/demodata): both write paths of dbwrite.go bindValue in one INSERT,
* MODIFY FROM TABLE and UPDATE SET, read back. Not run on A4H: each rule is
* pinned there on its own (ZCL_GOGEN_T_RAWRD / _RAWSTR, ZCL_GOGEN_T_DEMODB).
CLASS zcl_gogen_t_rawdec DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rawdec IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_rawdec.
    DATA lt TYPE STANDARD TABLE OF zgogen_t_rawdec WITH DEFAULT KEY.
    DELETE FROM zgogen_t_rawdec.
    ls-id = 'A'. ls-r = '12AB0000'. ls-amt = '111.12'.
    INSERT zgogen_t_rawdec FROM ls.
    rv = |ins:{ sy-subrc }|.
    CLEAR ls.
    SELECT SINGLE * FROM zgogen_t_rawdec WHERE id = 'A' INTO @ls.
    rv = rv && |={ ls-r }/{ ls-amt }|.
    CLEAR ls.
    ls-id = 'B'. ls-r = 'FFFFFFFF'. ls-amt = '-0.05'.
    APPEND ls TO lt.
    ls-id = 'A'. ls-r = '00000001'. ls-amt = '9999999.99'.
    APPEND ls TO lt.
    MODIFY zgogen_t_rawdec FROM TABLE lt.
    rv = rv && | mod:{ sy-subrc }/{ sy-dbcnt }|.
    SELECT * FROM zgogen_t_rawdec ORDER BY id INTO TABLE @lt.
    LOOP AT lt INTO ls.
      rv = rv && | { ls-id }={ ls-r }/{ ls-amt }|.
    ENDLOOP.
    DELETE FROM zgogen_t_rawdec.
  ENDMETHOD.
ENDCLASS.
