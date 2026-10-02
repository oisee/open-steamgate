CLASS ltcl_package DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS query_presence FOR TESTING.
    METHODS escaping FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_package IMPLEMENTATION.
  METHOD query_presence.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_query TYPE ihttpnvp.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    ls_query-name = `parent_name`.
    APPEND ls_query TO ls_request-query.
    zcl_osd_adt_package=>query( EXPORTING is_request = ls_request iv_name = `parent_name` IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_equals( act = lv_found exp = abap_true ).
    cl_abap_unit_assert=>assert_initial( lv_value ).
    zcl_osd_adt_package=>query( EXPORTING is_request = ls_request iv_name = `parentName` IMPORTING ev_found = lv_found ).
    cl_abap_unit_assert=>assert_equals( act = lv_found exp = abap_false ).
  ENDMETHOD.
  METHOD escaping.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_body TYPE string.
    lo_json = zcl_ajson=>parse( `{"name":"$PKG","description":"<&","library":true,"subpackages":[]}` ).
    lv_body = zcl_osd_adt_package=>document( lo_json ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*adtcore:description="&lt;&amp;"*` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*pak:isAddingObjectsAllowed="false"*` ).
  ENDMETHOD.
ENDCLASS.
