CLASS zcl_stg_http_handler DEFINITION PUBLIC CREATE PUBLIC.
* ICF entry point: if_http_extension on a real system, cl_express_icf_shim
* on Node. Everything OData happens in zcl_stg_dispatcher.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_stg_http_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA lv_method   TYPE string.
    DATA lv_path     TYPE string.
    DATA lv_host     TYPE string.
    DATA lt_options  TYPE tihttpnvp.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA ls_header   TYPE ihttpnvp.
    DATA lv_body     TYPE string.

    lv_method = server->request->get_header_field( '~request_method' ).
    lv_path   = server->request->get_header_field( '~path' ).
    lv_host   = server->request->get_header_field( 'host' ).
    IF lv_host IS INITIAL.
      lv_host = 'localhost'.
    ENDIF.
    server->request->get_form_fields_cs( CHANGING fields = lt_options ).
    lv_body = server->request->get_cdata( ).

* CSRF: UI5 fetches a token with a GET and sends it back on writes. There is
* no session to protect locally, so any token is accepted; hand one out.
    IF to_lower( server->request->get_header_field( 'x-csrf-token' ) ) = 'fetch'.
      server->response->set_header_field( name  = 'x-csrf-token'
                                          value = 'open-steamgate' ).
    ENDIF.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = lv_method
                                                iv_path    = lv_path
                                                it_options = lt_options
                                                iv_host    = lv_host
                                                iv_body    = lv_body
                                                iv_content_type = server->request->get_header_field( 'content-type' ) ).

    LOOP AT ls_response-headers INTO ls_header.
      server->response->set_header_field( name  = ls_header-name
                                          value = ls_header-value ).
    ENDLOOP.
    IF ls_response-content_type IS NOT INITIAL.
      server->response->set_header_field( name  = 'content-type'
                                          value = ls_response-content_type ).
    ENDIF.
    server->response->set_header_field( name  = 'dataserviceversion'
                                        value = '2.0' ).
    server->response->set_cdata( ls_response-body ).
    server->response->set_status( code   = ls_response-status
                                  reason = ls_response-reason ).
  ENDMETHOD.

ENDCLASS.
