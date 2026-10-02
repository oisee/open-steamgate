* An ICF handler that rolls out in the middle of a request: a WAIT gives
* the work process up (tools/osd-dialog-step.mjs), another request runs
* through cl_express_icf_shim meanwhile, and this one must still see its
* own request and answer into its own response when it rolls back in.
* test/dialog-step-icf.mjs drives it; the form field wait says how:
*   X  WAIT UP TO 1 SECONDS
*   C  WAIT UNTIL the request is another one UP TO 1 SECONDS (must time out)
*   M  receive AMC on ZOSD_AMC_TEST /text and WAIT FOR MESSAGING CHANNELS;
*      the receiver writes the message into this request's response
*   S  send one AMC message on ZOSD_AMC_TEST /text
CLASS zcl_osd_icf_wait_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    INTERFACES if_amc_message_receiver_text.
  PRIVATE SECTION.
    DATA mo_server TYPE REF TO if_http_server.
    DATA mv_count  TYPE i.
ENDCLASS.

CLASS zcl_osd_icf_wait_probe IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA lv_before   TYPE string.
    DATA lv_after    TYPE string.
    DATA lv_wait     TYPE string.
    DATA lv_subrc    TYPE string.
    DATA lo_request  TYPE REF TO if_http_request.
    DATA lo_consumer TYPE REF TO if_amc_message_consumer.
    DATA lx_amc      TYPE REF TO cx_amc_error.

    lv_before = server->request->get_header_field( '~path' ).
    lv_wait = server->request->get_form_field( 'wait' ).
    server->response->set_header_field( name  = 'x-probe-before'
                                        value = lv_before ).
    TRY.
        CASE lv_wait.
          WHEN 'X'.
            WAIT UP TO 1 SECONDS.
            lv_subrc = sy-subrc.
          WHEN 'C'.
            lo_request = server->request.
            WAIT UNTIL server->request <> lo_request UP TO 1 SECONDS.
            lv_subrc = sy-subrc.
          WHEN 'M'.
            mo_server = server.
            lo_consumer = zcl_osd_amc_test=>start_delivery( me ).
            WAIT FOR MESSAGING CHANNELS UNTIL mv_count >= 1 UP TO 2 SECONDS.
            lv_subrc = sy-subrc.
            lo_consumer->stop_message_delivery( me ).
          WHEN 'S'.
            zcl_osd_amc_test=>send_many( 1 ).
        ENDCASE.
      CATCH cx_amc_error INTO lx_amc.
        lv_subrc = lx_amc->get_text( ).
    ENDTRY.
    lv_after = server->request->get_header_field( '~path' ).
    server->response->set_header_field( name  = 'x-probe-after'
                                        value = lv_after ).
    server->response->set_header_field( name  = 'x-probe-subrc'
                                        value = lv_subrc ).
    server->response->set_header_field( name  = 'content-type'
                                        value = 'text/plain' ).
    server->response->set_cdata( lv_after ).
  ENDMETHOD.

  METHOD if_amc_message_receiver_text~receive.
    mo_server->response->set_header_field( name  = 'x-probe-amc'
                                           value = i_message ).
    mv_count = mv_count + 1.
  ENDMETHOD.

ENDCLASS.
