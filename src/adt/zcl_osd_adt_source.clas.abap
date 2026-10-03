CLASS zcl_osd_adt_source DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS source_type IMPORTING iv_pattern TYPE string RETURNING VALUE(rv_type) TYPE string.
    CLASS-METHODS read IMPORTING iv_type TYPE string iv_name TYPE string iv_include TYPE string DEFAULT `main`
      RETURNING VALUE(rs_read) TYPE zcl_osd_adt_host=>ty_read RAISING zcx_osd_adt.
    CLASS-METHODS include_document IMPORTING iv_name TYPE string iv_include TYPE string iv_uri TYPE string
      RETURNING VALUE(rv_body) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_source IMPLEMENTATION.
  METHOD source_type.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA lv_prefix TYPE string.
    lt_types = zcl_osd_adt_types=>sources( ).
    LOOP AT lt_types INTO ls_type.
      lv_prefix = `/sap/bc/adt/` && ls_type-collection && `/`.
      IF iv_pattern CS lv_prefix.
        rv_type = ls_type-type.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD read.
    DATA lx_error TYPE REF TO zcx_osd_adt.
*   B2a needs the extended READ/OBJECT contract. Go lacks OBJECT today.
    zcl_osd_adt_host=>require( `OBJECT` ).
    TRY.
        rs_read = zcl_osd_adt_host=>read( iv_type = iv_type iv_name = iv_name iv_include = iv_include ).
      CATCH zcx_osd_adt INTO lx_error.
        IF lx_error->status = 404.
          IF lx_error->message_text CS ` include `.
            lx_error = zcx_osd_adt=>not_found( iv_message = |{ iv_type } { iv_name } include { iv_include } does not exist| iv_miss = zcx_osd_adt=>c_miss_object ).
          ELSE.
            lx_error = zcx_osd_adt=>not_found( iv_message = |{ iv_type } { iv_name } does not exist| iv_miss = zcx_osd_adt=>c_miss_object ).
          ENDIF.
        ENDIF.
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_include TYPE string VALUE `main`.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA ls_read TYPE zcl_osd_adt_host=>ty_read.
    DATA lv_accept TYPE string.
    DATA lv_body TYPE string.
    DATA lv_uri TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_type = source_type( is_request-pattern ).
    READ TABLE is_request-params WITH KEY name = `name` INTO ls_param.
    lv_name = ls_param-value.
    READ TABLE is_request-params WITH KEY name = `include` INTO ls_param.
    IF sy-subrc = 0.
      lv_include = ls_param-value.
      IF lv_type <> `CLAS`.
        lx_error = zcx_osd_adt=>not_found( iv_message = |{ lv_type } { lv_name } include { lv_include } does not exist| iv_miss = zcx_osd_adt=>c_miss_object ).
        RAISE EXCEPTION lx_error.
      ENDIF.
    ENDIF.
    ls_read = read( iv_type = lv_type iv_name = lv_name iv_include = lv_include ).
    lv_accept = zcl_osd_adt_csrf=>header( it_headers = is_request-headers iv_name = `accept` ).
    IF is_request-pattern CP `*/includes/:include` AND find( val = lv_accept sub = `application/vnd.sap.adt.oo.classes.includes.` ) >= 0.
      lv_uri = `/sap/bc/adt/oo/classes/` && zcl_osd_adt_uri=>encode_component( to_lower( lv_name ) )
        && `/includes/` && lv_include && `/source/main`.
      lv_body = include_document( iv_name = ls_read-name iv_include = lv_include iv_uri = lv_uri ).
      rs_response = zcl_osd_adt_entity=>send( is_request = is_request iv_body = lv_body
        iv_type = `application/vnd.sap.adt.oo.classes.includes.v2+xml` ).
    ELSE.
      rs_response = zcl_osd_adt_entity=>send( is_request = is_request iv_body = ls_read-source
        iv_type = `text/plain; charset=utf-8` ).
    ENDIF.
  ENDMETHOD.
  METHOD include_document.
    rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes"\n|
      && |                        xmlns:adtcore="http://www.sap.com/adt/core"\n|
      && |                        xmlns:atom="http://www.w3.org/2005/Atom"\n|
      && |                        adtcore:name="{ zcl_osd_adt_xml=>esc( iv_name ) }"\n|
      && |                        adtcore:type="CLAS/I"\n|
      && |                        class:includeType="{ zcl_osd_adt_xml=>esc( iv_include ) }">\n|
      && |  <atom:link href="{ zcl_osd_adt_xml=>esc( iv_uri ) }" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>\n|
      && |</class:abapClassInclude>\n|.
  ENDMETHOD.
ENDCLASS.
