* string / c -> x and xstring, CORRESPONDING #( ), BIT-XOR of xstrings,
* CONV xstring (ultra/zvdb). Run on A4H 2026-09-24 in $ZOSG_TMP_0300 exactly
* as written here.
CLASS zcl_gogen_t_xconv DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_a,
             k     TYPE c LENGTH 4,
             n     TYPE i,
             s     TYPE c LENGTH 6,
             extra TYPE c LENGTH 2,
           END OF ty_a,
           BEGIN OF ty_b,
             s     TYPE string,
             k     TYPE c LENGTH 2,
             n     TYPE i,
             other TYPE c LENGTH 3,
           END OF ty_b,
           tt_b TYPE STANDARD TABLE OF ty_b WITH EMPTY KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xconv IMPLEMENTATION.
  METHOD run.
    DATA lv_x4 TYPE x LENGTH 4.
    DATA lv_xs TYPE xstring.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 6.
    DATA lt_s TYPE string_table.
    DATA ls_a TYPE ty_a.
    DATA ls_b TYPE ty_b.
    DATA lt_b TYPE tt_b.
    lt_s = VALUE #( ( `AB` ) ( `ab` ) ( `A` ) ( `ABG1` ) ( `AB CD` ) ( `1234567890` ) ( `` ) ( ` AB` ) ( `ABC` ) ( `0a1B` ) ).
    rv = `x4:`.
    LOOP AT lt_s INTO lv_s.
      lv_x4 = 'FFFFFFFF'.
      lv_x4 = lv_s.
      rv = rv && |{ lv_x4 };|.
    ENDLOOP.
    rv = rv && ` xs:`.
    LOOP AT lt_s INTO lv_s.
      lv_xs = lv_s.
      rv = rv && |{ xstrlen( lv_xs ) }={ lv_xs };|.
    ENDLOOP.
    lv_c = 'AB'.
    lv_x4 = lv_c.
    lv_xs = lv_c.
    rv = rv && | c:{ lv_x4 }/{ xstrlen( lv_xs ) }={ lv_xs }|.
    ls_a = VALUE #( k = 'ABCD' n = 7 s = 'xy' extra = 'EE' ).
    ls_b = VALUE #( s = `zz` k = 'QQ' n = 1 other = 'OOO' ).
    ls_b = CORRESPONDING #( ls_a ).
    rv = rv && | cor:[{ ls_b-s }]{ strlen( ls_b-s ) }/[{ ls_b-k }]/{ ls_b-n }/[{ ls_b-other }]|.
    APPEND CORRESPONDING #( ls_a ) TO lt_b.
    APPEND CORRESPONDING #( ls_a ) TO lt_b.
    LOOP AT lt_b INTO ls_b.
      rv = rv && |;[{ ls_b-s }]/[{ ls_b-k }]/{ ls_b-n }/[{ ls_b-other }]|.
    ENDLOOP.
    DATA(lx_a) = CONV xstring( '0F0F' ).
    DATA(lx_b) = CONV xstring( 'FF00' ).
    DATA(lx_c) = CONV xstring( 'FF' ).
    DATA(lx_r) = lx_a BIT-XOR lx_b.
    rv = rv && | xor:{ xstrlen( lx_r ) }={ lx_r }|.
    lx_r = lx_a BIT-XOR lx_c.
    rv = rv && |/{ xstrlen( lx_r ) }={ lx_r }|.
    lx_r = lx_c BIT-XOR lx_a.
    rv = rv && |/{ xstrlen( lx_r ) }={ lx_r }|.
    lx_r = CONV xstring( 'ABCDEF' ).
    lx_r = CONV xstring( lx_r ).
    DATA(lv_byte) = lx_r+1(1).
    rv = rv && | conv:{ lx_r }/{ lv_byte }/{ CONV i( lv_byte ) }|.
    lv_byte = CONV xstring( '0102' ).
    rv = rv && |/{ xstrlen( lv_byte ) }|.
  ENDMETHOD.
ENDCLASS.
