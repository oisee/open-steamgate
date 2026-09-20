CLASS ltcl_split DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
* The path parser, on the shapes a client actually sends.
*
* It is tested here and not only through HTTP because a parser checked in
* one shape is checked in one shape: a browser sends a query string, a
* directory URL with and without the trailing slash, a nested page, and an
* upper-case application name, and each of those is a different string.
  PRIVATE SECTION.
    METHODS the_application_and_its_page FOR TESTING.
    METHODS a_directory_url_is_the_index FOR TESTING.
    METHODS a_query_string_is_not_a_page FOR TESTING.
    METHODS a_nested_page_keeps_its_folder FOR TESTING.
    METHODS nonsense_yields_nothing FOR TESTING.
    METHODS check IMPORTING iv_path TYPE string iv_app TYPE string iv_page TYPE string.
ENDCLASS.

CLASS ltcl_split IMPLEMENTATION.

  METHOD check.
    DATA lv_app  TYPE string.
    DATA lv_page TYPE string.

    zcl_osd_bsp=>split( EXPORTING iv_path = iv_path
                        IMPORTING ev_app  = lv_app
                                  ev_page = lv_page ).
    cl_abap_unit_assert=>assert_equals( act = lv_app  exp = iv_app  msg = |app of { iv_path }| ).
    cl_abap_unit_assert=>assert_equals( act = lv_page exp = iv_page msg = |page of { iv_path }| ).
  ENDMETHOD.

  METHOD the_application_and_its_page.
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/index.html'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
*   the node may hand us only what follows it
    check( iv_path = 'zosd_008_app/index.html'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
    check( iv_path = '/zosd_008_app/index.html'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
  ENDMETHOD.

  METHOD a_directory_url_is_the_index.
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
  ENDMETHOD.

  METHOD a_query_string_is_not_a_page.
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/index.html?sap-client=001'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/?sap-client=001'
           iv_app  = 'ZOSD_008_APP' iv_page = 'index.html' ).
  ENDMETHOD.

  METHOD a_nested_page_keeps_its_folder.
*   the page name carries its folder, because that is what the descriptor
*   names it; flattening it here would lose i18n/i18n.properties
    check( iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/i18n/i18n.properties'
           iv_app  = 'ZOSD_008_APP' iv_page = 'i18n/i18n.properties' ).
  ENDMETHOD.

  METHOD nonsense_yields_nothing.
*   an empty answer, not a wrong one: the handler turns it into a named 404
    check( iv_path = '' iv_app = '' iv_page = '' ).
    check( iv_path = '/sap/bc/ui5_ui5/sap/' iv_app = '' iv_page = '' ).
    check( iv_path = '/' iv_app = '' iv_page = '' ).
  ENDMETHOD.

ENDCLASS.

CLASS ltcl_base DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
* The node's path and the offset the parser skips are one fact. This is the
* test the five above could not be: they check paths, so a literal offset
* beside the constant would keep them green while the parser cut the string
* in the wrong place.
  PRIVATE SECTION.
    METHODS a_longer_base_still_parses FOR TESTING.
ENDCLASS.

CLASS ltcl_base IMPLEMENTATION.

  METHOD a_longer_base_still_parses.
    DATA lv_app  TYPE string.
    DATA lv_page TYPE string.

*   A path that contains the base twice: the parser must skip the base's own
*   length from where it found it, so what follows is the application and not
*   a slice of the prefix. With a hard-coded offset this comes out wrong the
*   moment the constant and the number disagree.
    zcl_osd_bsp=>split( EXPORTING iv_path = '/anything/sap/bc/ui5_ui5/sap/zosd_008_app/index.html'
                        IMPORTING ev_app  = lv_app
                                  ev_page = lv_page ).
    cl_abap_unit_assert=>assert_equals( act = lv_app  exp = 'ZOSD_008_APP' ).
    cl_abap_unit_assert=>assert_equals( act = lv_page exp = 'index.html' ).
  ENDMETHOD.

ENDCLASS.

CLASS ltcl_namespace DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
* An application may live under any namespace. tools/osd-bsp-app.mjs writes
* nodes under `mindset` as well as `sap`, test/bsp-app.mjs asserts the
* corpus's /sap/bc/ui5_ui5/mindset/analyzer_detail/, and a parser that
* assumed `sap` answered nonsense for every other one.
  PRIVATE SECTION.
    METHODS any_namespace_parses FOR TESTING.
ENDCLASS.

CLASS ltcl_namespace IMPLEMENTATION.

  METHOD any_namespace_parses.
    DATA lv_app  TYPE string.
    DATA lv_page TYPE string.

    zcl_osd_bsp=>split( EXPORTING iv_path = '/sap/bc/ui5_ui5/mindset/analyzer_detail/index.html'
                        IMPORTING ev_app  = lv_app
                                  ev_page = lv_page ).
    cl_abap_unit_assert=>assert_equals( act = lv_app  exp = 'ANALYZER_DETAIL' ).
    cl_abap_unit_assert=>assert_equals( act = lv_page exp = 'index.html' ).

    zcl_osd_bsp=>split( EXPORTING iv_path = '/sap/bc/ui5_ui5/sap/zosd_008_app/i18n/i18n.properties'
                        IMPORTING ev_app  = lv_app
                                  ev_page = lv_page ).
    cl_abap_unit_assert=>assert_equals( act = lv_app  exp = 'ZOSD_008_APP' ).
    cl_abap_unit_assert=>assert_equals( act = lv_page exp = 'i18n/i18n.properties' ).
  ENDMETHOD.

ENDCLASS.
