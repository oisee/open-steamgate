* RAW(4) columns read, compared and written (ultra/zvdb). Run on A4H
* 2026-09-24 in $ZOSG_TMP_0300 exactly as written here, over a table of the
* shape of zgogen_t_raw.tabl.xml. Before this version, WHERE r = @x1 / @x5 /
* > @x1 / <> @x1 (an x of another length) did not activate ("not
* compatible").
CLASS zcl_gogen_t_rawrd DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS ids IMPORTING it TYPE string_table RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rawrd IMPLEMENTATION.
  METHOD ids.
    LOOP AT it INTO DATA(lv).
      rv = rv && lv.
    ENDLOOP.
    rv = rv && ` `.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE zgogen_t_raw.
    DATA lv_xs TYPE xstring.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_x6 TYPE x LENGTH 6.
    DATA lv_id TYPE c LENGTH 4.
    DATA lt_ids TYPE string_table.
    DATA lv_x4 TYPE x LENGTH 4 VALUE '12000000'.
    DATA lv_x1 TYPE x LENGTH 1 VALUE '12'.
    DATA lv_x5 TYPE x LENGTH 5 VALUE '1200000000'.
    DATA lv_x0 TYPE x LENGTH 4.
    DATA lv_xs1 TYPE xstring.
    DATA lv_xs4 TYPE xstring.
    DATA lv_xse TYPE xstring.
    DATA lv_xs5 TYPE xstring.
    DATA lx TYPE REF TO cx_root.
    DELETE FROM zgogen_t_raw.
    ls-id = 'A'. ls-r = '12000000'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'B'. ls-r = '12340000'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'C'. CLEAR ls-r. INSERT zgogen_t_raw FROM ls.
    ls-id = 'D'. ls-r = 'FFFFFFFF'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'E'. ls-r = '00000012'. INSERT zgogen_t_raw FROM ls.
    rv = 'xs:'.
    DO 5 TIMES.
      lv_id = substring( val = `ABCDE` off = sy-index - 1 len = 1 ).
      SELECT SINGLE r FROM zgogen_t_raw WHERE id = @lv_id INTO @lv_xs.
      rv = rv && |{ lv_id }{ xstrlen( lv_xs ) }={ lv_xs };|.
    ENDDO.
    rv = rv && ` x2:`.
    DO 5 TIMES.
      lv_id = substring( val = `ABCDE` off = sy-index - 1 len = 1 ).
      SELECT SINGLE r FROM zgogen_t_raw WHERE id = @lv_id INTO @lv_x2.
      rv = rv && |{ lv_id }={ lv_x2 };|.
      SELECT SINGLE r FROM zgogen_t_raw WHERE id = @lv_id INTO @lv_x6.
      rv = rv && |{ lv_x6 };|.
    ENDDO.
    lv_xs1 = lv_x1.
    lv_xs4 = lv_x4.
    lv_xs5 = lv_x5.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_xs5 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && ` eqs5:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && ` eqs5:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_x4 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && ` eq4:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && ` eq4:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_xs1 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `eqs1:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `eqs1:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_xs4 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `eqs4:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `eqs4:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_x0 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `eq0:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `eq0:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r = @lv_xse ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `eqe:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `eqe:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r < @lv_x4 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `lt4:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `lt4:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r > @lv_xs1 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `gts1:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `gts1:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    TRY.
        SELECT id FROM zgogen_t_raw WHERE r <> @lv_xs1 ORDER BY id INTO TABLE @lt_ids.
        rv = rv && `nes1:` && ids( lt_ids ).
      CATCH cx_root INTO lx.
        rv = rv && `nes1:` && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    SELECT id FROM zgogen_t_raw ORDER BY r, id INTO TABLE @lt_ids.
    rv = rv && `ord:` && ids( lt_ids ).
    UPDATE zgogen_t_raw SET r = @lv_x1 WHERE id = 'B'.
    SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'B' INTO @lv_xs.
    rv = rv && |set1:{ sy-dbcnt }/{ xstrlen( lv_xs ) }={ lv_xs } |.
    TRY.
        UPDATE zgogen_t_raw SET r = @lv_xs1 WHERE id = 'B'.
      CATCH cx_root INTO lx.
        rv = rv && cl_abap_classdescr=>get_class_name( lx ) && ` `.
    ENDTRY.
    SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'B' INTO @lv_xs.
    rv = rv && |sets1:{ xstrlen( lv_xs ) }={ lv_xs } |.
    UPDATE zgogen_t_raw SET r = @lv_x5 WHERE id = 'B'.
    SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'B' INTO @lv_xs.
    rv = rv && |set5:{ xstrlen( lv_xs ) }={ lv_xs }|.
    DELETE FROM zgogen_t_raw.
  ENDMETHOD.
ENDCLASS.
