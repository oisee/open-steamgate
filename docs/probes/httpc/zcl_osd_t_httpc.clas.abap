* Throwaway probe of CL_HTTP_CLIENT on an ABAP 7.5x system. Every call
* goes to the system's own ICM on localhost; the receiving side is either
* the SAP demo handler /sap/bc/abap/demo_post (echoes the query string in
* its form's action, and with input=X in the query the body's &-separated
* parts), or /sap/bc/soap/rfc calling the probe's own RFC module
* Z_OSD_T_HTTPC_SLEEP (a bounded WAIT, at most 10 seconds). The call logs on
* with an assertion ticket of the current user, so no password is involved.
CLASS zcl_osd_t_httpc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
* base: the system's own ICM, http://localhost:<ICM HTTP port> (SMICM, Goto > Services); set it before running
    CONSTANTS base TYPE string VALUE `http://localhost:8000`.
    CLASS-METHODS call
      IMPORTING
        iv_url         TYPE string
        iv_method      TYPE string OPTIONAL
        iv_ctype       TYPE string OPTIONAL
        iv_ctype_after TYPE abap_bool DEFAULT abap_false
        iv_body        TYPE string OPTIONAL
        iv_xbody       TYPE xstring OPTIONAL
        iv_hname       TYPE string OPTIONAL
        iv_hvalue      TYPE string OPTIONAL
        iv_timeout     TYPE i DEFAULT 0
        iv_ticket      TYPE abap_bool DEFAULT abap_true
        iv_find        TYPE string OPTIONAL
        iv_len         TYPE i DEFAULT 80
      RETURNING
        VALUE(rv_out)  TYPE string.
    CLASS-METHODS soap_sleep
      IMPORTING iv_seconds    TYPE i
                iv_text       TYPE string OPTIONAL
      RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS utf8
      IMPORTING iv_hex        TYPE xstring
      RETURNING VALUE(rv_str) TYPE string.
ENDCLASS.

CLASS zcl_osd_t_httpc IMPLEMENTATION.

  METHOD utf8.
    rv_str = cl_abap_codepage=>convert_from( iv_hex ).
  ENDMETHOD.

  METHOD soap_sleep.
    rv_xml = `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">`
      && `<soap-env:Body><urn:Z_OSD_T_HTTPC_SLEEP xmlns:urn="urn:sap-com:document:sap:rfc:functions">`
      && |<IV_SECONDS>{ iv_seconds }</IV_SECONDS><IV_TEXT>{ iv_text }</IV_TEXT>|
      && `</urn:Z_OSD_T_HTTPC_SLEEP></soap-env:Body></soap-env:Envelope>`.
  ENDMETHOD.

  METHOD call.
    DATA li_client TYPE REF TO if_http_client.
    DATA lv_code   TYPE i.
    DATA lv_reason TYPE string.
    DATA lv_msg    TYPE string.
    DATA lv_resp   TYPE string.
    DATA lv_t0     TYPE timestampl.
    DATA lv_t1     TYPE timestampl.
    DATA lv_ms     TYPE i.
    DATA lv_off    TYPE i.
    DATA lx        TYPE REF TO cx_root.
    DATA lt_fields TYPE tihttpnvp.
    DATA ls_field  TYPE ihttpnvp.

    TRY.
        cl_http_client=>create_by_url(
          EXPORTING url = iv_url
          IMPORTING client = li_client
          EXCEPTIONS argument_not_found = 1 plugin_not_active = 2
                     internal_error = 3 OTHERS = 4 ).
        rv_out = |create:{ sy-subrc }|.
        IF li_client IS INITIAL.
          RETURN.
        ENDIF.
        rv_out = |{ rv_out } uri:{ li_client->request->get_header_field( '~request_uri' ) }|
          && | qs:{ li_client->request->get_header_field( '~query_string' ) }|.
        li_client->propertytype_logon_popup = if_http_client=>co_disabled.
        IF iv_ticket = abap_true.
          li_client->send_sap_assertion_ticket( client = sy-mandt system_id = sy-sysid ).
        ENDIF.
        IF iv_method IS NOT INITIAL.
          li_client->request->set_method( iv_method ).
        ENDIF.
        IF iv_hname IS NOT INITIAL.
          li_client->request->set_header_field( name = iv_hname value = iv_hvalue ).
        ENDIF.
        IF iv_ctype IS NOT INITIAL AND iv_ctype_after = abap_false.
          li_client->request->set_content_type( iv_ctype ).
        ENDIF.
        IF iv_body IS NOT INITIAL.
          li_client->request->set_cdata( iv_body ).
        ENDIF.
        IF iv_xbody IS NOT INITIAL.
          li_client->request->set_data( iv_xbody ).
        ENDIF.
        IF iv_ctype IS NOT INITIAL AND iv_ctype_after = abap_true.
          li_client->request->set_content_type( iv_ctype ).
        ENDIF.
        rv_out = |{ rv_out } reqdata:{ li_client->request->get_data( ) }|.

        GET TIME STAMP FIELD lv_t0.
        li_client->send(
          EXPORTING timeout = iv_timeout
          EXCEPTIONS http_communication_failure = 1 http_invalid_state = 2
                     http_processing_failed = 3 http_invalid_timeout = 4 OTHERS = 5 ).
        rv_out = |{ rv_out } send:{ sy-subrc }|.
        IF sy-subrc <> 0.
          li_client->get_last_error( IMPORTING code = lv_code message = lv_msg ).
          rv_out = |{ rv_out } sendmsg:{ sy-msgid }/{ sy-msgno }/{ sy-msgv1 } lasterr:{ lv_code }/{ lv_msg }|.
        ENDIF.
        li_client->receive(
          EXCEPTIONS http_communication_failure = 1 http_invalid_state = 2
                     http_processing_failed = 3 OTHERS = 5 ).
        DATA(lv_rc) = sy-subrc.
        rv_out = |{ rv_out } receive:{ lv_rc }|.
        IF lv_rc <> 0.
          rv_out = |{ rv_out } recvmsg:{ sy-msgid }/{ sy-msgno }/{ sy-msgv1 }|.
        ENDIF.
        GET TIME STAMP FIELD lv_t1.
        lv_ms = cl_abap_tstmp=>subtract( tstmp1 = lv_t1 tstmp2 = lv_t0 ) * 1000.
        rv_out = |{ rv_out } ms:{ lv_ms }|.
        IF lv_rc <> 0.
          li_client->get_last_error( IMPORTING code = lv_code message = lv_msg ).
          rv_out = |{ rv_out } lasterr:{ lv_code }/{ lv_msg }|.
        ENDIF.
        rv_out = |{ rv_out } reqlen:{ li_client->request->get_header_field( 'content-length' ) }|
          && | reqctype:{ li_client->request->get_header_field( 'content-type' ) }|
          && | reqdata2:{ li_client->request->get_data( ) }|.
        li_client->response->get_status( IMPORTING code = lv_code reason = lv_reason ).
        rv_out = |{ rv_out } status:{ lv_code }/{ lv_reason }|
          && | ~status_code:{ li_client->response->get_header_field( '~status_code' ) }|
          && | ~status_reason:{ li_client->response->get_header_field( '~status_reason' ) }|
          && | ~server_protocol:{ li_client->response->get_header_field( '~server_protocol' ) }|
          && | respctype:{ li_client->response->get_content_type( ) }|.
        li_client->response->get_header_fields( CHANGING fields = lt_fields ).
        rv_out = |{ rv_out } tilde:|.
        LOOP AT lt_fields INTO ls_field WHERE name CP '~*'.
          rv_out = |{ rv_out }{ ls_field-name },|.
        ENDLOOP.
        lv_resp = li_client->response->get_cdata( ).
        IF iv_find IS NOT INITIAL.
          lv_off = find( val = lv_resp sub = iv_find ).
          IF lv_off < 0.
            rv_out = |{ rv_out } find:none|.
            lv_off = 0.
          ELSE.
            rv_out = |{ rv_out } find:{ lv_off }|.
          ENDIF.
        ENDIF.
        lv_resp = substring( val = lv_resp off = lv_off
          len = nmin( val1 = iv_len val2 = strlen( lv_resp ) - lv_off ) ).
        rv_out = |{ rv_out } body:{ lv_resp } bodyhex:{ cl_abap_codepage=>convert_to( lv_resp ) }|.
        li_client->close( ).
      CATCH cx_root INTO lx.
        rv_out = |{ rv_out } CAUGHT:{ cl_abap_classdescr=>get_class_name( lx ) }:{ lx->get_text( ) }|.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
