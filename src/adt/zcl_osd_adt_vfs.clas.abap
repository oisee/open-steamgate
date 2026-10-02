"! B6 VFS full-tree rendering uses SYSTEM raw: ajson exceeds 5 ms.
"! The host's shared renderer preserves package and object index order.
CLASS zcl_osd_adt_vfs DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS response IMPORTING iv_body TYPE string RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
    CLASS-METHODS document IMPORTING iv_xml TYPE string RETURNING VALUE(rv_body) TYPE string RAISING zcx_osd_adt.
ENDCLASS.
CLASS zcl_osd_adt_vfs IMPLEMENTATION.
  METHOD document.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
*   OSGo does not mount ADT or implement PACKAGES. Refuse before rendering.
    zcl_osd_adt_host=>require( `PACKAGES` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `SYSTEM` iv_type = `VFS` iv_name = iv_xml ).
    rv_body = ls_answer-source.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lo_decoder TYPE REF TO cl_abap_conv_in_ce.
    DATA lv_xml TYPE string.
    lo_decoder = cl_abap_conv_in_ce=>create( encoding = `UTF-8` ignore_cerr = abap_true ).
    lo_decoder->convert( EXPORTING input = is_request-body IMPORTING data = lv_xml ).
    rs_response = response( document( lv_xml ) ).
  ENDMETHOD.
  METHOD response.
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8`.
    rs_response-body = iv_body.
  ENDMETHOD.
ENDCLASS.
