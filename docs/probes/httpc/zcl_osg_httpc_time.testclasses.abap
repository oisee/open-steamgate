* SEND's TIMEOUT against ZOSG_HTTPC_SLEEP behind /sap/bc/soap/rfc (waits
* IV_SECONDS, at most 10), and q5: a POST with a query and no body.
CLASS ltcl DEFINITION FINAL FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS t0_constants FOR TESTING.
    METHODS t1_sleep6_timeout2 FOR TESTING.
    METHODS t2_sleep3_timeout10 FOR TESTING.
    METHODS t3_sleep3_default FOR TESTING.
    METHODS t4_invalid_timeout FOR TESTING.
    METHODS t5_sleep2_infinite FOR TESTING.
    METHODS q5_post_query_nobody_uri FOR TESTING.
    METHODS sleep IMPORTING iv_seconds TYPE i iv_timeout TYPE i.
    METHODS out IMPORTING iv TYPE string.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD out.
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg = iv ).
  ENDMETHOD.
  METHOD sleep.
    out( zcl_osg_httpc_probe=>call( iv_url = zcl_osg_httpc_probe=>base && `/sap/bc/soap/rfc` iv_method = `POST`
      iv_ctype = `text/xml; charset=utf-8` iv_body = zcl_osg_httpc_probe=>soap_sleep( iv_seconds = iv_seconds iv_text = `t` )
      iv_timeout = iv_timeout iv_find = `<EV_TEXT>` iv_len = 20 ) ).
  ENDMETHOD.
  METHOD t0_constants.
    out( |default:{ if_http_client=>co_timeout_default } infinite:{ if_http_client=>co_timeout_infinite }| ).
  ENDMETHOD.
  METHOD t1_sleep6_timeout2.
    sleep( iv_seconds = 6 iv_timeout = 2 ).
  ENDMETHOD.
  METHOD t2_sleep3_timeout10.
    sleep( iv_seconds = 3 iv_timeout = 10 ).
  ENDMETHOD.
  METHOD t3_sleep3_default.
    sleep( iv_seconds = 3 iv_timeout = if_http_client=>co_timeout_default ).
  ENDMETHOD.
  METHOD t4_invalid_timeout.
    sleep( iv_seconds = 0 iv_timeout = -5 ).
  ENDMETHOD.
  METHOD t5_sleep2_infinite.
    sleep( iv_seconds = 2 iv_timeout = if_http_client=>co_timeout_infinite ).
  ENDMETHOD.
  METHOD q5_post_query_nobody_uri.
    out( zcl_osg_httpc_probe=>call( iv_url = zcl_osg_httpc_probe=>base && `/sap/bc/abap/demo_post?k=v&z=1`
      iv_method = `POST` iv_find = `action=` iv_len = 80 ) ).
  ENDMETHOD.
ENDCLASS.
