CLASS ltcl_media DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS the_show_is_there FOR TESTING RAISING cx_static_check.
    METHODS the_music_is_there FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_object_is_empty FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_media IMPLEMENTATION.

  METHOD the_show_is_there.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    zcl_lsd_media=>load( EXPORTING iv_name = 'ZLSD-SHOW' IMPORTING ev_data = lv_data ev_size = lv_size ).
    " the recording is gzip since 2026-09-17: 225 KB where the text was 5.2 MB.
    " The page inflates it with DecompressionStream, so nothing here does, and
    " what this test can still check is that the object arrived whole and is
    " the kind of file the page expects.
    cl_abap_unit_assert=>assert_true( xsdbool( lv_size > 100000 ) ).
    cl_abap_unit_assert=>assert_true( xsdbool( lv_size < 1000000 ) ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( lv_data ) exp = lv_size ).
    " gzip's magic number, so a plain-text recording put back by mistake fails
    " here rather than in a browser
    DATA lv_magic TYPE xstring.
    lv_magic = lv_data+0(2).
    cl_abap_unit_assert=>assert_equals( act = lv_magic exp = '1F8B' ).
  ENDMETHOD.

  METHOD the_music_is_there.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    zcl_lsd_media=>load( EXPORTING iv_name = 'ZLSD-MUSIC' IMPORTING ev_data = lv_data ev_size = lv_size ).
    cl_abap_unit_assert=>assert_true( xsdbool( lv_size > 1000000 ) ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( lv_data ) exp = lv_size ).
  ENDMETHOD.

  METHOD an_unknown_object_is_empty.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    zcl_lsd_media=>load( EXPORTING iv_name = 'ZLSD-NOTHING' IMPORTING ev_data = lv_data ev_size = lv_size ).
    cl_abap_unit_assert=>assert_initial( lv_data ).
    cl_abap_unit_assert=>assert_equals( act = lv_size exp = 0 ).
  ENDMETHOD.

ENDCLASS.
