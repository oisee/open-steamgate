* SELECT SINGLE ... INTO (a, b) / (@a, @b) / (@DATA(a), @DATA(b)) and UPDATE
* SET raw = xstring of another length (ultra/zvdb). Run on A4H 2026-09-24 in
* $ZOSG_TMP_0300 exactly as written here.
CLASS zcl_gogen_t_rawsel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rawsel IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_raw.
    DATA lv_xs TYPE xstring.
    DATA lv_xs1 TYPE xstring.
    DATA lv_xs5 TYPE xstring.
    DATA lv_a TYPE c LENGTH 2 VALUE 'kk'.
    DATA lv_b TYPE x LENGTH 4 VALUE '0A0B0C0D'.
    DATA lv_s TYPE string VALUE `keep`.
    DATA lx TYPE REF TO cx_root.
    DELETE FROM zgogen_t_raw.
    ls-id = 'A'. ls-r = '12000000'. INSERT zgogen_t_raw FROM ls.
    ls-id = 'BB'. ls-r = '12340000'. INSERT zgogen_t_raw FROM ls.
    SELECT SINGLE id r FROM zgogen_t_raw INTO (lv_a, lv_b) WHERE id = 'BB'.
    rv = |old:{ sy-subrc }/{ lv_a }/{ lv_b }|.
    SELECT SINGLE id r FROM zgogen_t_raw INTO (lv_a, lv_b) WHERE id = 'ZZ'.
    rv = rv && | miss:{ sy-subrc }/{ lv_a }/{ lv_b }|.
    SELECT SINGLE id, r FROM zgogen_t_raw WHERE id = 'A' INTO (@lv_s, @lv_xs).
    rv = rv && | new:{ sy-subrc }/[{ lv_s }]/{ lv_xs }|.
    SELECT SINGLE r, id FROM zgogen_t_raw WHERE id = 'A' INTO (@DATA(lv_r1), @DATA(lv_i1)).
    rv = rv && | inl:{ sy-subrc }/{ lv_r1 }/[{ lv_i1 }]|.
    lv_i1 = 'ABCDEFG'.
    lv_r1 = CONV xstring( '1234567890' ).
    rv = rv && |/{ lv_r1 }/[{ lv_i1 }]|.
    lv_s = `keep`.
    SELECT SINGLE id, r FROM zgogen_t_raw WHERE id = 'ZZ' INTO (@lv_s, @lv_xs).
    rv = rv && | nmiss:{ sy-subrc }/{ lv_s }/{ lv_xs }|.
    SELECT SINGLE r, id FROM zgogen_t_raw WHERE id = 'ZZ' INTO (@DATA(lv_r2), @DATA(lv_i2)).
    rv = rv && | imiss:{ sy-subrc }/{ lv_r2 }/[{ lv_i2 }]|.
    lv_xs1 = CONV xstring( '56' ).
    lv_xs5 = CONV xstring( '5600000077' ).
    TRY.
        UPDATE zgogen_t_raw SET r = @lv_xs1 WHERE id = 'A'.
        rv = rv && | us1:{ sy-subrc }/{ sy-dbcnt }|.
      CATCH cx_root INTO lx.
        rv = rv && | us1:| && cl_abap_classdescr=>get_class_name( lx ).
    ENDTRY.
    SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'A' INTO @lv_xs.
    rv = rv && |={ lv_xs }|.
    TRY.
        UPDATE zgogen_t_raw SET r = @lv_xs5 WHERE id = 'A'.
        rv = rv && | us5:{ sy-subrc }/{ sy-dbcnt }|.
      CATCH cx_root INTO lx.
        rv = rv && | us5:| && cl_abap_classdescr=>get_class_name( lx ).
    ENDTRY.
    SELECT SINGLE r FROM zgogen_t_raw WHERE id = 'A' INTO @lv_xs.
    rv = rv && |={ lv_xs }|.
    DELETE FROM zgogen_t_raw.
  ENDMETHOD.
ENDCLASS.
