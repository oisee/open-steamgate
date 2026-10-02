"! B5: ADT package document. Host lists retain their supplied order.
CLASS zcl_osd_adt_package DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS query IMPORTING is_request TYPE zif_osd_adt_route=>ty_request iv_name TYPE string
      EXPORTING ev_value TYPE string ev_found TYPE abap_bool.
    CLASS-METHODS get IMPORTING iv_name TYPE string iv_user TYPE string
      RETURNING VALUE(ro_json) TYPE REF TO zcl_ajson RAISING zcx_osd_adt.
    CLASS-METHODS document IMPORTING io_json TYPE REF TO zcl_ajson RETURNING VALUE(rv_body) TYPE string RAISING zcx_ajson_error.
ENDCLASS.
CLASS zcl_osd_adt_package IMPLEMENTATION.
  METHOD query.
    DATA ls_field TYPE ihttpnvp.
    CLEAR: ev_value, ev_found.
    READ TABLE is_request-query INTO ls_field WITH KEY name = iv_name.
    IF sy-subrc = 0.
      ev_found = abap_true.
      ev_value = ls_field-value.
    ENDIF.
  ENDMETHOD.
  METHOD get.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    zcl_osd_adt_host=>require( `PACKAGE` ).
    CREATE OBJECT lo_input.
    lo_input->add( iv_name = `name` iv_value = iv_name ).
    lo_input->add( iv_name = `mode` iv_value = `local` ).
    lo_input->add( iv_name = `user` iv_value = iv_user ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PACKAGE` iv_json = lo_input->document( ) ).
    TRY.
        ro_json = zcl_ajson=>parse( ls_answer-json ).
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid PACKAGE answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_accept TYPE string.
    READ TABLE is_request-params WITH KEY name = `name` INTO ls_param.
    lo_json = get( iv_name = ls_param-value iv_user = is_request-session-user ).
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.packages.v1+xml; charset=utf-8`.
    lv_accept = zcl_osd_adt_csrf=>header( it_headers = is_request-headers iv_name = `accept` ).
    FIND FIRST OCCURRENCE OF `packages.v2+xml` IN lv_accept.
    IF sy-subrc = 0.
      rs_response-content_type = `application/vnd.sap.adt.packages.v2+xml; charset=utf-8`.
    ENDIF.
    rs_response-body = document( lo_json ).
  ENDMETHOD.
  METHOD document.
    DATA lv_parent TYPE string.
    DATA lv_children TYPE string.
    DATA lv_name TYPE string.
    DATA lv_desc TYPE string.
    DATA lv_path TYPE string.
    DATA lv_allowed TYPE string VALUE `true`.
    DATA lv_index TYPE string.
    DATA lt_children TYPE string_table.
    DATA lv_child TYPE string.
    lv_name = io_json->get_string( `/parent` ).
    IF lv_name IS NOT INITIAL.
      lv_parent = |\n  <pak:superPackage adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( lv_name ) ) }" adtcore:type="DEVC/K" adtcore:name="{ zcl_osd_adt_xml=>esc( lv_name ) }"/>|.
    ENDIF.
    lt_children = io_json->members( `/subpackages` ).
    LOOP AT lt_children INTO lv_child.
      IF sy-tabix > 1.
        lv_children = lv_children && cl_abap_char_utilities=>newline.
      ENDIF.
      lv_path = `/subpackages/` && lv_child.
      lv_name = io_json->get_string( lv_path && `/name` ).
      lv_desc = io_json->get_string( lv_path && `/description` ).
      lv_children = lv_children && |    <pak:packageRef adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( lv_name ) ) }" adtcore:type="DEVC/K" adtcore:name="{ zcl_osd_adt_xml=>esc( lv_name ) }" adtcore:description="{ zcl_osd_adt_xml=>esc( lv_desc ) }"/>|.
    ENDLOOP.
    IF io_json->get_boolean( `/library` ) = abap_true.
      lv_allowed = `false`.
    ENDIF.
    rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<pak:package xmlns:pak="http://www.sap.com/adt/packages"\n|
      && |             xmlns:adtcore="http://www.sap.com/adt/core"\n|
      && |             adtcore:name="{ zcl_osd_adt_xml=>esc( io_json->get_string( `/name` ) ) }"\n|
      && |             adtcore:type="DEVC/K"\n|
      && |             adtcore:version="active"\n|
      && |             adtcore:language="EN"\n|
      && |             adtcore:masterLanguage="EN"\n|
      && |             adtcore:responsible="{ `OSD` }"\n|
      && |             adtcore:createdAt="{ `1970-01-01T00:00:00Z` }"\n|
      && |             adtcore:createdBy="{ `OSD` }"\n|
      && |             adtcore:changedAt="{ `1970-01-01T00:00:00Z` }"\n|
      && |             adtcore:changedBy="{ `OSD` }"\n|
      && |             adtcore:descriptionTextLimit="60"\n|
      && |             adtcore:description="{ zcl_osd_adt_xml=>esc( io_json->get_string( `/description` ) ) }">\n|
      && |  <atom:link href="/sap/bc/adt/packages/valuehelps/applicationcomponents" rel="applicationcomponents" type="application/vnd.sap.adt.nameditems.v1+xml" title="Application Components Value Help" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <atom:link href="/sap/bc/adt/packages/valuehelps/softwarecomponents" rel="softwarecomponents" type="application/vnd.sap.adt.nameditems.v1+xml" title="Software Components Value Help" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <atom:link href="/sap/bc/adt/packages/valuehelps/transportlayers" rel="transportlayers" type="application/vnd.sap.adt.nameditems.v1+xml" title="Transport Layers Value Help" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <atom:link href="/sap/bc/adt/packages/valuehelps/translationrelevances" rel="translationrelevances" type="application/vnd.sap.adt.nameditems.v1+xml" title="Transport Relevances Value Help" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <atom:link href="/sap/bc/adt/packages/valuehelps/abaplanguageversions" rel="abaplanguageversions" type="application/vnd.sap.adt.nameditems.v1+xml" title="ABAP Language Version Value Help" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <pak:attributes pak:packageType="development"\n|
      && |                  pak:isPackageTypeEditable="false"\n|
      && |                  pak:isAddingObjectsAllowed="{ lv_allowed }"\n|
      && |                  pak:isAddingObjectsAllowedEditable="false"\n|
      && |                  pak:isEncapsulated="false"\n|
      && |                  pak:isEncapsulationEditable="false"\n|
      && |                  pak:isEncapsulationVisible="false"\n|
      && |                  pak:recordChanges="false"\n|
      && |                  pak:isRecordChangesEditable="false"\n|
      && |                  pak:isSwitchVisible="false"\n|
      && |                  pak:languageVersion=""\n|
      && |                  pak:isLanguageVersionVisible="true"\n|
      && |                  pak:isLanguageVersionEditable="false"/>{ lv_parent }\n|
      && |  <pak:applicationComponent pak:name="" pak:description="No application component assigned" pak:isVisible="true" pak:isEditable="false"/>\n|
      && |  <pak:transport>\n|
      && |    <pak:softwareComponent pak:name="LOCAL" pak:description="Local Developments (No Automatic Transport)" pak:isVisible="true" pak:isEditable="false"/>\n|
      && |    <pak:transportLayer pak:name="" pak:description="" pak:isVisible="false" pak:isEditable="false"/>\n|
      && |  </pak:transport>\n|
      && |  <pak:useAccesses pak:isVisible="false"/>\n|
      && |  <pak:packageInterfaces pak:isVisible="false"/>\n|
      && |  <pak:subPackages>\n|
      && |{ lv_children }\n|
      && |  </pak:subPackages>\n|
      && |</pak:package>\n|.
  ENDMETHOD.
ENDCLASS.
