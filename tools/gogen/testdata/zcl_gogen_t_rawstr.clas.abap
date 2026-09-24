* UPDATE SET raw = @string (ultra/zvdb): the string -> x move rule. Run on
* A4H 2026-09-24 in $ZOSG_TMP_0300 exactly as written here.
CLASS zcl_gogen_t_rawstr DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rawstr IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_raw.
    DATA lv_xs TYPE xstring.
    DATA lv_s TYPE string.
    DATA lt_s TYPE string_table.
    DATA lx TYPE REF TO cx_root.
    DELETE FROM zgogen_t_raw.
    ls-id = 'A'. ls-r = 'FFFFFFFF'. INSERT zgogen_t_raw FROM ls.
    lt_s = VALUE #( ( `12AB` ) ( `12ab` ) ( `1234567890AB` ) ( `XYZ` ) ( `` ) ( `ABC` ) ( `12345678` ) ).
    LOOP AT lt_s INTO lv_s.
      UPDATE zgogen_t_raw SET r = 'FFFFFFFF' WHERE id = 'A'.
      TRY.
          UPDATE zgogen_t_raw SET r = @lv_s WHERE id = 'A'.
          rv = rv && |[{ lv_s }]{ sy-subrc }/{ sy-dbcnt }|.
        CATCH cx_root INTO lx.
          rv = rv && |[{ lv_s }]| && cl_abap_classdescr=>get_class_name( lx ).
      ENDTRY.
      SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'A' INTO @lv_xs.
      rv = rv && |={ lv_xs } |.
    ENDLOOP.
    DELETE FROM zgogen_t_raw.
  ENDMETHOD.
ENDCLASS.
