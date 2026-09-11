CLASS zcl_stg_http_handler DEFINITION PUBLIC CREATE PUBLIC.
* ICF entry point for the Gateway. The dispatcher lands here (QW1-QW3);
* until then every request is answered with 501 so the wire is testable.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_stg_http_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA lv_path TYPE string.
    DATA lv_body TYPE string.

    lv_path = server->request->get_header_field( '~path' ).

    lv_body = |\{"error":\{"code":"STG/NOT_IMPLEMENTED","message":\{"lang":"en","value":"open-steamgate: no dispatcher yet for { lv_path }"\}\}\}|.

    server->response->set_header_field( name  = 'content-type'
                                        value = 'application/json' ).
    server->response->set_header_field( name  = 'dataserviceversion'
                                        value = '2.0' ).
    server->response->set_cdata( lv_body ).
    server->response->set_status( code   = 501
                                  reason = 'Not Implemented' ).
  ENDMETHOD.

ENDCLASS.
