CLASS zcl_osd_adt_create_valid DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.
CLASS zcl_osd_adt_create_valid IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_resource TYPE string VALUE `OO`.
    DATA lv_result TYPE string.
    DATA lv_severity TYPE string VALUE `ERROR`.
    DATA lv_message TYPE string.
    IF to_lower( is_request-path ) = `/sap/bc/adt/packages/validation`
        OR to_lower( is_request-path ) = `/sap/bc/adt/packages/validation/`.
      lv_resource = `PACKAGE`.
    ENDIF.
    CREATE OBJECT lo_input.
    lo_input->add( iv_name = `kind` iv_value = `CREATE_VALIDATION` ).
    lo_input->add( iv_name = `resource` iv_value = lv_resource ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `objtype` IMPORTING ev_value = lv_value ev_found = lv_found ).
    lo_input->add( iv_name = `objtype` iv_value = lv_value ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `objname` IMPORTING ev_value = lv_value ev_found = lv_found ).
    lo_input->add( iv_name = `objname` iv_value = lv_value ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `packagename` IMPORTING ev_value = lv_value ev_found = lv_found ).
    lo_input->add( iv_name = `packagename` iv_value = lv_value ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PARSE` iv_json = lo_input->document( ) ).
    lo_json = zcl_ajson=>parse( ls_answer-json ).
    IF lo_json->get_boolean( `/success` ) = abap_true.
      lv_result = `X`.
      lv_severity = `SUCCESS`.
    ENDIF.
    lv_message = lo_json->get_string( `/message` ).
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.as+xml; charset=utf-8`.
    rs_response-body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><CHECK_RESULT>{ lv_result }</CHECK_RESULT><SEVERITY>{ lv_severity }</SEVERITY><SHORT_TEXT>{ zcl_osd_adt_xml=>esc( lv_message ) }</SHORT_TEXT></DATA></asx:values></asx:abap>|.
  ENDMETHOD.
ENDCLASS.
