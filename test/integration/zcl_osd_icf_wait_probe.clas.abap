* An ICF handler that rolls out in the middle of a request: WAIT UP TO
* gives the work process up (tools/osd-dialog-step.mjs), another request
* runs through cl_express_icf_shim meanwhile, and this one must still see
* its own request and answer into its own response when it rolls back in.
* test/dialog-step-icf.mjs drives it.
CLASS zcl_osd_icf_wait_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
ENDCLASS.

CLASS zcl_osd_icf_wait_probe IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA lv_before TYPE string.
    DATA lv_after  TYPE string.
    DATA lv_wait   TYPE string.

    lv_before = server->request->get_header_field( '~path' ).
    lv_wait = server->request->get_form_field( 'wait' ).
    server->response->set_header_field( name  = 'x-probe-before'
                                        value = lv_before ).
    IF lv_wait = 'X'.
      WAIT UP TO 1 SECONDS.
    ENDIF.
    lv_after = server->request->get_header_field( '~path' ).
    server->response->set_header_field( name  = 'x-probe-after'
                                        value = lv_after ).
    server->response->set_header_field( name  = 'content-type'
                                        value = 'text/plain' ).
    server->response->set_cdata( lv_after ).
  ENDMETHOD.

ENDCLASS.
