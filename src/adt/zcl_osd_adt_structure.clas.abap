"! B2b: objectstructure XML over ordered PARSE OUTLINE facts.
CLASS zcl_osd_adt_structure DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS document IMPORTING io_json TYPE REF TO zcl_ajson iv_base TYPE string
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_ajson_error.
  PRIVATE SECTION.
    CLASS-METHODS element IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string iv_pad TYPE string
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_ajson_error.
    CLASS-METHODS children IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string iv_pad TYPE string
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_ajson_error.
    CLASS-METHODS attributes IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_ajson_error.
    CLASS-METHODS links IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string iv_pad TYPE string
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_ajson_error.
    CLASS-METHODS link IMPORTING iv_rel TYPE string iv_href TYPE string iv_pad TYPE string iv_type TYPE string
      RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_structure IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA ls_name TYPE zif_osd_adt_route=>ty_param.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    DATA lv_accept TYPE string.
    READ TABLE is_request-params WITH KEY name = `name` INTO ls_name.
    lt_types = zcl_osd_adt_types=>sources( ).
    LOOP AT lt_types INTO ls_type.
      IF is_request-pattern = zcl_osd_adt_router=>c_base && `/` && ls_type-collection && `/:name/objectstructure`
        OR is_request-pattern = zcl_osd_adt_router=>c_base && `/` && ls_type-collection && `/:name`.
        EXIT.
      ENDIF.
    ENDLOOP.
    zcl_osd_adt_host=>require( `PARSE` ).
    TRY.
        CREATE OBJECT lo_input.
        lo_input->add( iv_name = `kind` iv_value = `OUTLINE` ).
        lo_input->add( iv_name = `type` iv_value = ls_type-type ).
        lo_input->add( iv_name = `name` iv_value = ls_name-value ).
        ls_answer = zcl_osd_adt_host=>store( iv_command = `PARSE` iv_json = lo_input->document( ) ).
        lo_json = zcl_ajson=>parse( iv_json = ls_answer-json iv_keep_item_order = abap_true ).
        IF lo_json->get_boolean( `/found` ) = abap_false.
          lx_error = zcx_osd_adt=>not_found( iv_message = ls_type-type && ` ` && ls_name-value && ` does not exist`
            iv_miss = zcx_osd_adt=>c_miss_object ).
          RAISE EXCEPTION lx_error.
        ENDIF.
        rs_response-body = document( io_json = lo_json iv_base = is_request-uri ).
      CATCH zcx_ajson_error INTO lx_json.
        lx_error = zcx_osd_adt=>internal( lx_json->get_text( ) ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.objectstructure.v2+xml; charset=utf-8`.
    lv_accept = zcl_osd_adt_csrf=>header( it_headers = is_request-headers iv_name = `accept` ).
    IF lv_accept NS `application/vnd.sap.adt.objectstructure.v2+xml`
      AND ( lv_accept CS `application/vnd.sap.adt.objectstructure+xml` OR lv_accept CS `application/xml` ).
      rs_response-content_type = `application/vnd.sap.adt.objectstructure+xml; charset=utf-8`.
    ENDIF.
  ENDMETHOD.
  METHOD document.
    DATA lv_nl TYPE string.
    DATA lv_pad TYPE string.
    DATA lv_version TYPE string.
    DATA lv_inner TYPE string.
    DATA lv_children TYPE string.
    lv_version = io_json->get_string( `/version` ).
    IF lv_version IS NOT INITIAL.
      lv_version = ` adtcore:version="` && zcl_osd_adt_xml=>esc( lv_version ) && `"`.
    ENDIF.
    lv_nl = cl_abap_char_utilities=>newline.
    lv_pad = `                                   `.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<abapsource:objectStructureElement xmlns:abapsource="http://www.sap.com/adt/abapsource"` && lv_nl
      && lv_pad && `xmlns:adtcore="http://www.sap.com/adt/core"` && lv_nl
      && lv_pad && `xmlns:atom="http://www.w3.org/2005/Atom"` && lv_nl
      && lv_pad && `xml:base="` && zcl_osd_adt_xml=>esc( iv_base ) && `"` && lv_nl
      && lv_pad && attributes( io_json = io_json iv_path = `` ) && lv_version && `>` && lv_nl.
    lv_inner = links( io_json = io_json iv_path = `/links` iv_pad = `  ` ).
    lv_children = children( io_json = io_json iv_path = `/children` iv_pad = `  ` ).
    IF lv_inner IS NOT INITIAL AND lv_children IS NOT INITIAL.
      lv_inner = lv_inner && lv_nl.
    ENDIF.
    rv_xml = rv_xml && lv_inner && lv_children && lv_nl
      && `</abapsource:objectStructureElement>` && lv_nl.
  ENDMETHOD.
  METHOD children.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    lt_members = zcl_osd_adt_json=>ordered_members( io_json = io_json iv_path = iv_path ).
    LOOP AT lt_members INTO lv_member.
      IF sy-tabix > 1.
        rv_xml = rv_xml && cl_abap_char_utilities=>newline.
      ENDIF.
      rv_xml = rv_xml && element( io_json = io_json iv_path = iv_path && `/` && lv_member iv_pad = iv_pad ).
    ENDLOOP.
  ENDMETHOD.
  METHOD attributes.
    DATA lt_keys TYPE string_table.
    DATA lv_key TYPE string.
    DATA lv_attr TYPE string.
    DATA lv_value TYPE string.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    SPLIT `name,type,visibility,level,clif_name,testclass,testmethod,final,uri` AT `,` INTO TABLE lt_keys.
    LOOP AT lt_keys INTO lv_key.
      lv_path = iv_path && `/` && lv_key.
      IF io_json->exists( lv_path ) = abap_false.
        CONTINUE.
      ENDIF.
      lv_value = io_json->get_string( lv_path ).
      CASE lv_key.
        WHEN `name` OR `type`.
          lv_attr = `adtcore:` && lv_key.
          lv_value = zcl_osd_adt_xml=>esc( lv_value ).
        WHEN `uri`.
          lv_attr = `abapsource:sourceUri`.
          lv_value = zcl_osd_adt_xml=>esc( lv_value ).
        WHEN OTHERS.
          lv_attr = lv_key.
          lv_value = zcl_osd_adt_xml=>esc( lv_value ).
      ENDCASE.
      IF rv_xml IS NOT INITIAL.
        rv_xml = rv_xml && ` `.
      ENDIF.
      rv_xml = rv_xml && lv_attr && `="` && lv_value && `"`.
    ENDLOOP.
    lt_members = zcl_osd_adt_json=>ordered_members( io_json = io_json iv_path = iv_path && `/extra` ).
    LOOP AT lt_members INTO lv_member.
      lv_path = iv_path && `/extra/` && lv_member.
      rv_xml = rv_xml && ` ` && io_json->get_string( lv_path && `/name` ) && `="`
        && zcl_osd_adt_xml=>esc( io_json->get_string( lv_path && `/value` ) ) && `"`.
    ENDLOOP.
  ENDMETHOD.
  METHOD link.
    rv_xml = iv_pad && `<atom:link rel="http://www.sap.com/adt/relations/source/`
      && zcl_osd_adt_xml=>esc( iv_rel ) && `" href="` && zcl_osd_adt_xml=>esc( iv_href ) && `"`.
    IF iv_type IS NOT INITIAL.
      rv_xml = rv_xml && ` type="` && zcl_osd_adt_xml=>esc( iv_type ) && `"`.
    ENDIF.
    rv_xml = rv_xml && `/>`.
  ENDMETHOD.
  METHOD links.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA lv_rel TYPE string.
    DATA lv_href TYPE string.
    DATA lv_type TYPE string.
    lt_members = zcl_osd_adt_json=>ordered_members( io_json = io_json iv_path = iv_path ).
    LOOP AT lt_members INTO lv_member.
      lv_path = iv_path && `/` && lv_member.
      lv_rel = io_json->get_string( lv_path && `/rel` ).
      lv_href = io_json->get_string( lv_path && `/href` ).
      IF rv_xml IS NOT INITIAL.
        rv_xml = rv_xml && cl_abap_char_utilities=>newline.
      ENDIF.
      lv_type = io_json->get_string( lv_path && `/type` ).
      rv_xml = rv_xml && link( iv_rel = lv_rel iv_href = lv_href iv_pad = iv_pad iv_type = lv_type ).
    ENDLOOP.
  ENDMETHOD.
  METHOD element.
    DATA lv_inner TYPE string.
    DATA lv_children TYPE string.
    lv_inner = links( io_json = io_json iv_path = iv_path && `/links` iv_pad = iv_pad && `  ` ).
    lv_children = children( io_json = io_json iv_path = iv_path && `/children` iv_pad = iv_pad && `  ` ).
    IF lv_inner IS NOT INITIAL AND lv_children IS NOT INITIAL.
      lv_inner = lv_inner && cl_abap_char_utilities=>newline.
    ENDIF.
    lv_inner = lv_inner && lv_children.
    rv_xml = iv_pad && `<abapsource:objectStructureElement ` && attributes( io_json = io_json iv_path = iv_path ).
    IF lv_inner IS INITIAL.
      rv_xml = rv_xml && `/>`.
    ELSE.
      rv_xml = rv_xml && `>` && cl_abap_char_utilities=>newline && lv_inner
        && cl_abap_char_utilities=>newline && iv_pad && `</abapsource:objectStructureElement>`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
