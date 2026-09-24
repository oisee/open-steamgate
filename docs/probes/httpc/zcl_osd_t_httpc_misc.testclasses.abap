* Connection failures (f), where the status comes from (s), how a POST with
* a query in the URL is sent (q), get_cdata after set_data (d1).
* demo_post without input=X answers a form whose action carries the
* request's ~QUERY_STRING; with input=X it answers the body's &-parts.
CLASS ltcl DEFINITION FINAL FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS f1_refused FOR TESTING.
    METHODS f2_tls_to_plain FOR TESTING.
    METHODS f3_bad_scheme FOR TESTING.
    METHODS f4_header_newline FOR TESTING.
    METHODS f5_header_name_space FOR TESTING.
    METHODS f6_method_token FOR TESTING.
    METHODS f7_receive_before_send FOR TESTING.
    METHODS s1_403 FOR TESTING.
    METHODS s2_404 FOR TESTING.
    METHODS s3_401 FOR TESTING.
    METHODS s4_500 FOR TESTING.
    METHODS q1_post_query_body FOR TESTING.
    METHODS q2_post_query_nobody FOR TESTING.
    METHODS q3_post_query_input_body FOR TESTING.
    METHODS q4_get_query FOR TESTING.
    METHODS d1_get_cdata_after_set_data FOR TESTING.
    METHODS out IMPORTING iv TYPE string.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD out.
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg = iv ).
  ENDMETHOD.
  METHOD f1_refused.
    out( zcl_osd_t_httpc=>call( iv_url = `http://localhost:1/x` ) ).
  ENDMETHOD.
  METHOD f2_tls_to_plain.
    out( zcl_osd_t_httpc=>call( iv_url = replace( val = zcl_osd_t_httpc=>base sub = `http:` with = `https:` ) && `/sap/bc/abap/demo_post` ) ).
  ENDMETHOD.
  METHOD f3_bad_scheme.
    out( zcl_osd_t_httpc=>call( iv_url = replace( val = zcl_osd_t_httpc=>base sub = `http:` with = `ftp:` ) && `/x` ) ).
  ENDMETHOD.
  METHOD f4_header_newline.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post`
      iv_hname = `x-bad` iv_hvalue = |a{ cl_abap_char_utilities=>newline }b| ) ).
  ENDMETHOD.
  METHOD f5_header_name_space.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post`
      iv_hname = `x bad` iv_hvalue = `v` ) ).
  ENDMETHOD.
  METHOD f6_method_token.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post`
      iv_method = `GE T` ) ).
  ENDMETHOD.
  METHOD f7_receive_before_send.
    DATA li_client TYPE REF TO if_http_client.
    DATA lv_code TYPE i.
    DATA lv_msg TYPE string.
    DATA lv_out TYPE string.
    cl_http_client=>create_by_url( EXPORTING url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post` IMPORTING client = li_client ).
    li_client->receive( EXCEPTIONS http_communication_failure = 1 http_invalid_state = 2
      http_processing_failed = 3 OTHERS = 5 ).
    lv_out = |receive:{ sy-subrc } msg:{ sy-msgid }/{ sy-msgno }|.
    li_client->get_last_error( IMPORTING code = lv_code message = lv_msg ).
    lv_out = |{ lv_out } lasterr:{ lv_code }/{ lv_msg }|.
    li_client->close( ).
    out( lv_out ).
  ENDMETHOD.
  METHOD s1_403.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/public/ping` iv_ticket = abap_false ) ).
  ENDMETHOD.
  METHOD s2_404.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/zz_osd_no_such_node` ) ).
  ENDMETHOD.
  METHOD s3_401.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post` iv_ticket = abap_false ) ).
  ENDMETHOD.
  METHOD s4_500.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/soap/rfc` iv_method = `POST`
      iv_ctype = `text/xml; charset=utf-8` iv_body = `<not-soap/>` ) ).
  ENDMETHOD.
  METHOD q1_post_query_body.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post?k=v&z=1`
      iv_method = `POST` iv_ctype = `text/plain` iv_body = `BODY` iv_find = `action=` iv_len = 120 ) ).
  ENDMETHOD.
  METHOD q2_post_query_nobody.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post?input=X&k=v`
      iv_method = `POST` iv_find = `<table` iv_len = 400 ) ).
  ENDMETHOD.
  METHOD q3_post_query_input_body.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post?input=X&k=v`
      iv_method = `POST` iv_ctype = `text/plain` iv_body = `b=1` iv_find = `<table` iv_len = 400 ) ).
  ENDMETHOD.
  METHOD q4_get_query.
    out( zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post?k=v&z=1`
      iv_find = `action=` iv_len = 120 ) ).
  ENDMETHOD.
  METHOD d1_get_cdata_after_set_data.
    DATA li_client TYPE REF TO if_http_client.
    DATA lv_out TYPE string.
    cl_http_client=>create_by_url( EXPORTING url = zcl_osd_t_httpc=>base IMPORTING client = li_client ).
    li_client->request->set_data( '41C3A9' ).
    lv_out = |plain-utf8-bytes:[{ li_client->request->get_cdata( ) }]|.
    li_client->request->set_content_type( `text/plain; charset=utf-8` ).
    lv_out = |{ lv_out } with-utf8-ctype:[{ li_client->request->get_cdata( ) }]|.
    li_client->request->set_cdata( `xyz` ).
    lv_out = |{ lv_out } after-set_cdata:[{ li_client->request->get_cdata( ) }] data:{ li_client->request->get_data( ) }|.
    li_client->close( ).
    out( lv_out ).
  ENDMETHOD.
ENDCLASS.
