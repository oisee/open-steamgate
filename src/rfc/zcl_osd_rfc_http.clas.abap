CLASS zcl_osd_rfc_http DEFINITION PUBLIC CREATE PUBLIC.
* The ICF end of the RFC channel: if_http_extension on a real system,
* cl_express_icf_shim on Node, the service worker in the browser preview.
* It does nothing but turn a request into three strings and an answer back
* into a response, so that zcl_osd_rfc_channel can be tested without a
* listener - the same split as zcl_stg_http_handler and zcl_stg_dispatcher.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
ENDCLASS.

CLASS zcl_osd_rfc_http IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle(
      iv_method = server->request->get_method( )
*     the path below the service node: the shim strips the base, and so does
*     the ICF, which is why a channel mounted anywhere reads the same routes
      iv_path   = server->request->get_header_field( '~path_info' )
      iv_body   = server->request->get_cdata( ) ).

    server->response->set_header_field( name  = 'content-type'
                                        value = ls_response-content_type ).
    server->response->set_cdata( ls_response-body ).
    server->response->set_status( code   = ls_response-status
                                  reason = ls_response-reason ).
  ENDMETHOD.

ENDCLASS.
