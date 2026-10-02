"! The ICF end of the ADT facade in ABAP (ADR 0007): if_http_extension on
"! /sap/bc/adt on a system, cl_express_icf_shim on Node. It turns the
"! request into a ZIF_OSD_ADT_ROUTE=>TY_REQUEST, asks ZCL_OSD_ADT_ROUTER,
"! and writes the answer back -- the same split as zcl_osd_rfc_http and
"! zcl_osd_rfc_channel, so the router is tested without a listener.
"!
"! A refusal is caught here once: ZCX_OSD_ADT as its own status and
"! document, anything else as a 500 ExceptionInternalError in our
"! namespace, which is what the Node facade's answered( ) does.
"!
"! A request no ABAP row serves is answered 404 with the header
"! X-OSD-Served-By: HOST. On Node that header is the signal to the front in
"! tools/adt-abap-front.mjs, which drops this answer and lets the Node
"! facade serve the request; on a system there is no host behind it, and
"! the 404 with its document is the honest answer.
"!
"! No route writes rows yet, so there is no COMMIT here: slice 2's LOCK and
"! UNLOCK write to the lock server, which no COMMIT or ROLLBACK touches at
"! _SCOPE 1. When the session itself moves into tables, its rows must
"! survive a 4xx (port-map.md, risk 1): the commit then goes here, whatever
"! the status.
CLASS zcl_osd_adt_handler DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    CONSTANTS c_served_by TYPE string VALUE `x-osd-served-by`.

    "! the answer to one request, without a server: what the handler writes
    CLASS-METHODS answer
      IMPORTING is_request   TYPE zif_osd_adt_route=>ty_request
      EXPORTING es_response  TYPE zif_osd_adt_route=>ty_response
                ev_served_by TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS refusal
      IMPORTING ix_error           TYPE REF TO zcx_osd_adt
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
ENDCLASS.

CLASS zcl_osd_adt_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_headers TYPE tihttpnvp.
    DATA ls_header TYPE ihttpnvp.
    DATA lv_served_by TYPE string.

    ls_request-method = to_upper( server->request->get_header_field( '~request_method' ) ).
    ls_request-path = server->request->get_header_field( '~path' ).
    server->request->get_form_fields_cs( CHANGING fields = ls_request-query ).
    server->request->get_header_fields( CHANGING fields = lt_headers ).
*   the pseudo fields (~path, ~request_method, ...) are the ICF's, not the
*   client's
    LOOP AT lt_headers INTO ls_header WHERE name NP '~*'.
      APPEND ls_header TO ls_request-headers.
    ENDLOOP.
    ls_request-body = server->request->get_data( ).

    answer( EXPORTING is_request   = ls_request
            IMPORTING es_response  = ls_response
                      ev_served_by = lv_served_by ).

    LOOP AT ls_response-headers INTO ls_header.
      server->response->set_header_field( name  = ls_header-name
                                          value = ls_header-value ).
    ENDLOOP.
    IF lv_served_by = zcl_osd_adt_router=>c_host.
      server->response->set_header_field( name  = c_served_by
                                          value = zcl_osd_adt_router=>c_host ).
    ENDIF.
    IF ls_response-content_type IS NOT INITIAL.
      server->response->set_header_field( name  = 'content-type'
                                          value = ls_response-content_type ).
    ENDIF.
    server->response->set_cdata( ls_response-body ).
    server->response->set_status( code   = ls_response-status
                                  reason = '' ).
  ENDMETHOD.

  METHOD answer.
    DATA ls_result TYPE zcl_osd_adt_router=>ty_result.
    DATA lx_adt TYPE REF TO zcx_osd_adt.
    DATA lx_root TYPE REF TO cx_root.
    DATA lv_text TYPE string.

    CLEAR: es_response, ev_served_by.
    TRY.
        ls_result = zcl_osd_adt_router=>dispatch( is_request ).
        ev_served_by = ls_result-served_by.
        IF ev_served_by = zcl_osd_adt_router=>c_host.
          lv_text = |{ is_request-method } { is_request-path } is not served by ABAP here|.
          lx_adt = zcx_osd_adt=>not_found( lv_text ).
          es_response = refusal( lx_adt ).
        ELSE.
          es_response = ls_result-response.
        ENDIF.
      CATCH zcx_osd_adt INTO lx_adt.
        ev_served_by = zcl_osd_adt_router=>c_abap.
        es_response = refusal( lx_adt ).
      CATCH cx_root INTO lx_root.
        ev_served_by = zcl_osd_adt_router=>c_abap.
        lv_text = lx_root->get_text( ).
        lx_adt = zcx_osd_adt=>internal( lv_text ).
        es_response = refusal( lx_adt ).
    ENDTRY.
  ENDMETHOD.

  METHOD refusal.
    rs_response-status = ix_error->status.
    rs_response-content_type = `application/xml; charset=utf-8`.
    rs_response-body = ix_error->document( ).
  ENDMETHOD.

ENDCLASS.
