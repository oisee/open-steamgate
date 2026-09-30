* ultra/httpc: one request through open-abap-core's CL_HTTP_CLIENT, and what
* the ABAP gets back, as text. tools/gogen/httpc.mjs runs it on Node (the
* transpiler and open-abap-core's kernel lines) and on the Go host
* (go/abap/httpc.go) against the same local server and compares both the
* bytes the server received and this text.
CLASS zcl_gogen_t_httpc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS call
      IMPORTING
        iv_url        TYPE string
        iv_method     TYPE string
        iv_ctype      TYPE string
        iv_body       TYPE string
        iv_xbody      TYPE xstring
        it_headers    TYPE tihttpnvp
        it_form       TYPE tihttpnvp
        iv_user       TYPE string
        iv_times      TYPE i
      RETURNING
        VALUE(rv_out) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_httpc IMPLEMENTATION.

  METHOD call.
    DATA li_client TYPE REF TO if_http_client.
    DATA ls_field  TYPE ihttpnvp.
    DATA lt_fields TYPE tihttpnvp.
    DATA lv_code   TYPE i.
    DATA lv_reason TYPE string.

    cl_http_client=>create_by_url(
      EXPORTING
        url    = iv_url
      IMPORTING
        client = li_client ).
    rv_out = |create:{ sy-subrc }|.

    IF iv_method IS NOT INITIAL.
      li_client->request->set_method( iv_method ).
    ENDIF.
    LOOP AT it_headers INTO ls_field.
      li_client->request->set_header_field(
        name  = ls_field-name
        value = ls_field-value ).
    ENDLOOP.
    LOOP AT it_form INTO ls_field.
      li_client->request->set_form_field(
        name  = ls_field-name
        value = ls_field-value ).
    ENDLOOP.
    IF iv_ctype IS NOT INITIAL.
      li_client->request->set_content_type( iv_ctype ).
    ENDIF.
    IF iv_body IS NOT INITIAL.
      li_client->request->set_cdata( iv_body ).
    ENDIF.
    IF iv_xbody IS NOT INITIAL.
      li_client->request->set_data( iv_xbody ).
    ENDIF.
    IF iv_user IS NOT INITIAL.
      li_client->authenticate(
        username = iv_user
        password = 'secret' ).
    ENDIF.

    DO iv_times TIMES.
      li_client->send(
        EXCEPTIONS
          http_communication_failure = 1
          OTHERS                     = 4 ).
      rv_out = |{ rv_out } send:{ sy-subrc }|.
      li_client->receive(
        EXCEPTIONS
          OTHERS = 4 ).
      rv_out = |{ rv_out } receive:{ sy-subrc }|.
      li_client->response->get_status(
        IMPORTING
          code   = lv_code
          reason = lv_reason ).
      rv_out = |{ rv_out } status:{ lv_code }/{ lv_reason } ctype:{ li_client->response->get_content_type( ) }|.
      CLEAR lt_fields.
      li_client->response->get_header_fields( CHANGING fields = lt_fields ).
      LOOP AT lt_fields INTO ls_field.
        rv_out = |{ rv_out } h:{ ls_field-name }={ ls_field-value }|.
      ENDLOOP.
      rv_out = |{ rv_out } body:{ li_client->response->get_data( ) }|.
    ENDDO.

    li_client->close( ).
  ENDMETHOD.

ENDCLASS.
