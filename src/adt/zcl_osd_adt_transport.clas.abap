CLASS zcl_osd_adt_transport DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_type TYPE string VALUE `application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData`.
    CLASS-METHODS document IMPORTING iv_uri TYPE string iv_type TYPE string iv_name TYPE string
      iv_operation TYPE string iv_package TYPE string RETURNING VALUE(rv_xml) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS field IMPORTING it_xml TYPE zif_osd_adt_xml=>tt_element iv_name TYPE string
      EXPORTING ev_value TYPE string ev_found TYPE abap_bool.
    CLASS-METHODS value IMPORTING iv_name TYPE string iv_value TYPE string RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_transport IMPLEMENTATION.
  METHOD field.
    DATA ls_element TYPE zif_osd_adt_xml=>ty_element.
    CLEAR: ev_value, ev_found.
    READ TABLE it_xml INTO ls_element WITH KEY uri = `` local = iv_name.
    ev_found = boolc( sy-subrc = 0 ).
    ev_value = ls_element-text.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lt_xml TYPE zif_osd_adt_xml=>tt_element.
    DATA lv_uri TYPE string.
    DATA lv_operation TYPE string.
    DATA lv_package TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA ls_named TYPE zcl_osd_adt_types=>ty_object.
    DATA ls_object TYPE zcl_osd_adt_host=>ty_object.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lt_xml = is_request-xml.
    IF lt_xml IS INITIAL AND is_request-body IS NOT INITIAL.
      lt_xml = zcl_osd_adt_request_xml=>parse( is_request-body ).
    ENDIF.
    field( EXPORTING it_xml = lt_xml iv_name = `URI` IMPORTING ev_value = lv_uri ev_found = lv_found ).
    field( EXPORTING it_xml = lt_xml iv_name = `DEVCLASS` IMPORTING ev_value = lv_package ev_found = lv_found ).
    IF lv_found = abap_false.
      lv_package = `$TMP`.
    ENDIF.
    field( EXPORTING it_xml = lt_xml iv_name = `OPERATION` IMPORTING ev_value = lv_operation ev_found = lv_found ).
    IF lv_found = abap_false.
      lv_operation = `I`.
    ENDIF.
    ls_named = zcl_osd_adt_types=>object_from_uri( iv_uri = lv_uri iv_sources_only = abap_true ).
    IF ls_named-ok = abap_false.
      lx_error = zcx_osd_adt=>transport_check_failed( `URI malformed` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    IF ls_named-found = abap_true.
      TRY.
          ls_object = zcl_osd_adt_host=>object( iv_type = ls_named-type iv_name = ls_named-name ).
          IF ls_object-found = abap_true.
            lv_package = ls_object-package.
          ENDIF.
        CATCH zcx_osd_adt.
*         Node treats every OBJECT refusal as not found.
      ENDTRY.
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = c_type.
    rs_response-body = document( iv_uri = lv_uri iv_type = ls_named-type iv_name = ls_named-name
      iv_operation = lv_operation iv_package = lv_package ).
  ENDMETHOD.
  METHOD value.
    rv_xml = `      <` && iv_name && `>` && zcl_osd_adt_xml=>esc( iv_value )
      && `</` && iv_name && `>` && cl_abap_char_utilities=>newline.
  ENDMETHOD.
  METHOD document.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">` && lv_nl
      && `  <asx:values>` && lv_nl && `    <DATA>` && lv_nl
      && value( iv_name = `PGMID` iv_value = `R3TR` )
      && value( iv_name = `OBJECT` iv_value = zcl_osd_adt_types=>adt_type( iv_type ) )
      && value( iv_name = `OBJECTNAME` iv_value = iv_name )
      && value( iv_name = `OPERATION` iv_value = iv_operation )
      && value( iv_name = `DEVCLASS` iv_value = iv_package )
      && value( iv_name = `CTEXT` iv_value = `` )
      && value( iv_name = `KORRFLAG` iv_value = `` )
      && value( iv_name = `AS4USER` iv_value = `` )
      && value( iv_name = `PDEVCLASS` iv_value = `` )
      && value( iv_name = `DLVUNIT` iv_value = `LOCAL` )
      && value( iv_name = `NAMESPACE` iv_value = `` )
      && value( iv_name = `RESULT` iv_value = `S` )
      && value( iv_name = `RECORDING` iv_value = `` )
      && value( iv_name = `EXISTING_REQ_ONLY` iv_value = `` )
      && value( iv_name = `TADIRDEVC` iv_value = iv_package )
      && value( iv_name = `URI` iv_value = iv_uri )
      && `      <MESSAGES/>` && lv_nl && `      <REQUESTS/>` && lv_nl && `      <LOCKS/>` && lv_nl
      && `    </DATA>` && lv_nl && `  </asx:values>` && lv_nl && `</asx:abap>` && lv_nl.
  ENDMETHOD.
ENDCLASS.
