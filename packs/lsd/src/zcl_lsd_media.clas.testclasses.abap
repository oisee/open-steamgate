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
    cl_abap_unit_assert=>assert_true( xsdbool( lv_size > 1000000 ) ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( lv_data ) exp = lv_size ).
    " the recording starts with its header line
    DATA lv_first TYPE xstring.
    lv_first = lv_data+0(20).
    DATA(lv_head) = cl_abap_codepage=>convert_from( lv_first ).
    cl_abap_unit_assert=>assert_equals( act = substring( val = lv_head len = 6 ) exp = '{"cols' ).
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
