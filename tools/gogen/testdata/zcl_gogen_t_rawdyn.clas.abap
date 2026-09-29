* A literal against a RAW(4) column, static and in a dynamic WHERE
* (ultra/zvdb). Run on A4H 2026-09-24 in $ZOSG_TMP_0300 exactly as written
* here.
CLASS zcl_gogen_t_rawdyn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rawdyn IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_raw.
    DATA lt_ids TYPE string_table.
    DATA lt_w TYPE string_table.
    DATA lv_w TYPE string.
    DATA lx TYPE REF TO cx_root.
    DELETE FROM zgogen_t_raw.
    ls-id = 'A'. ls-r = '12000000'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'B'. ls-r = '12340000'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'C'. CLEAR ls-r. INSERT zgogen_t_raw FROM ls.
    ls-id = 'D'. ls-r = 'FFFFFFFF'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'E'. ls-r = 'ABCDEF01'. INSERT zgogen_t_raw FROM ls.
    SELECT id FROM zgogen_t_raw WHERE r = '12000000' ORDER BY id INTO TABLE @lt_ids.
    rv = `st4:`.
    LOOP AT lt_ids INTO DATA(lv_i1). rv = rv && lv_i1. ENDLOOP.
    SELECT id FROM zgogen_t_raw WHERE r < 'ABCDEF01' ORDER BY id INTO TABLE @lt_ids.
    rv = rv && ` stlt:`.
    LOOP AT lt_ids INTO lv_i1. rv = rv && lv_i1. ENDLOOP.
    lt_w = VALUE #( ( `r = '12000000'` ) ( `r = '12'` ) ( `r = '1200000000'` ) ( `r < '12340000'` )
      ( `r = 'abcdef01'` ) ( `r = 'ABCDEF01'` ) ( `r = 'XYZ'` ) ( `r = ''` ) ( `r = '00000000'` ) ( `r = 12` ) ( `r = ' 12000000'` ) ( `r = '1200000 '` ) ).
    LOOP AT lt_w INTO lv_w.
      rv = rv && | [{ lv_w }]:|.
      TRY.
          SELECT id FROM zgogen_t_raw WHERE (lv_w) ORDER BY id INTO TABLE @lt_ids.
          LOOP AT lt_ids INTO lv_i1. rv = rv && lv_i1. ENDLOOP.
        CATCH cx_root INTO lx.
          rv = rv && cl_abap_classdescr=>get_class_name( lx ).
      ENDTRY.
    ENDLOOP.
    DELETE FROM zgogen_t_raw.
  ENDMETHOD.
ENDCLASS.
