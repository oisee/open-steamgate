* A session the test sets up: one session, its token, the cookies it
* answers, and what the handler asked of it.
CLASS ltcl_session_double DEFINITION FOR TESTING FINAL.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_session.
    DATA ms_session TYPE zif_osd_adt_session=>ty_session.
    DATA mt_cookies TYPE string_table.
    DATA mv_raise TYPE abap_bool.
    DATA mv_asked_id TYPE string.
    DATA mv_asked_token TYPE string.
    DATA mv_asked TYPE i.
    DATA mt_seen_cookies TYPE tihttpnvp.
ENDCLASS.

CLASS ltcl_session_double IMPLEMENTATION.

  METHOD zif_osd_adt_session~resolve.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    mt_seen_cookies = it_cookies.
    IF mv_raise = abap_true.
      lx_error = zcx_osd_adt=>internal( `no session table` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    rs_session = ms_session.
  ENDMETHOD.

  METHOD zif_osd_adt_session~cookies.
    rt_cookies = mt_cookies.
  ENDMETHOD.

  METHOD zif_osd_adt_session~token_valid.
    mv_asked = mv_asked + 1.
    mv_asked_id = iv_id.
    mv_asked_token = iv_token.
    rv_valid = boolc( iv_id = ms_session-id AND iv_token = ms_session-token ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~end.
    RETURN.
  ENDMETHOD.

  METHOD zif_osd_adt_session~alive.
    rv_alive = abap_true.
  ENDMETHOD.

  METHOD zif_osd_adt_session~enq_context_ended.
    RETURN.
  ENDMETHOD.

  METHOD zif_osd_adt_session~adopt_handle.
    CLEAR rv_handle.
  ENDMETHOD.

  METHOD zif_osd_adt_session~release_handle.
    CLEAR: ev_type, ev_name.
  ENDMETHOD.

  METHOD zif_osd_adt_session~holds.
    rv_holds = abap_false.
  ENDMETHOD.

ENDCLASS.

CLASS ltcl_csrf DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The CSRF gate of the handler against a session double: the token on
* every answer, fetch answered, a write without the session's token
* refused as the Node middleware refuses it (tools/adt-session.mjs,
* refuseToken). The path has no ABAP row, so no route and no host runs:
* what is under test is what the handler does around the router.
  PRIVATE SECTION.
    CONSTANTS c_path TYPE string VALUE `/sap/bc/adt/no/such/resource`.
    CONSTANTS c_token TYPE string VALUE `tOkEn-of-the-session-0001`.
    DATA mo_session TYPE REF TO ltcl_session_double.
    METHODS setup.
    METHODS call
      IMPORTING iv_method          TYPE string
                iv_token           TYPE string OPTIONAL
                iv_cookie          TYPE string OPTIONAL
      EXPORTING ev_served_by       TYPE string
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
    METHODS headers_named
      IMPORTING is_response     TYPE zif_osd_adt_route=>ty_response
                iv_name         TYPE string
      RETURNING VALUE(rt_value) TYPE string_table.
    METHODS assert_refused
      IMPORTING is_response TYPE zif_osd_adt_route=>ty_response.
    METHODS a_get_carries_the_token FOR TESTING RAISING cx_static_check.
    METHODS fetch_is_answered_on_get FOR TESTING RAISING cx_static_check.
    METHODS fetch_is_answered_on_head FOR TESTING RAISING cx_static_check.
    METHODS a_write_without_token FOR TESTING RAISING cx_static_check.
    METHODS a_write_with_a_wrong_token FOR TESTING RAISING cx_static_check.
    METHODS a_write_asking_fetch FOR TESTING RAISING cx_static_check.
    METHODS every_unsafe_method FOR TESTING RAISING cx_static_check.
    METHODS a_write_with_the_token FOR TESTING RAISING cx_static_check.
    METHODS safe_methods_are_not_gated FOR TESTING RAISING cx_static_check.
    METHODS the_token_is_case_exact FOR TESTING RAISING cx_static_check.
    METHODS a_mixed_case_method FOR TESTING RAISING cx_static_check.
    METHODS cookies_go_first FOR TESTING RAISING cx_static_check.
    METHODS a_refusal_keeps_cookies FOR TESTING RAISING cx_static_check.
    METHODS a_route_header_is_replaced FOR TESTING RAISING cx_static_check.
    METHODS no_session_no_gate FOR TESTING RAISING cx_static_check.
    METHODS a_session_that_fails FOR TESTING RAISING cx_static_check.
    METHODS a_token_that_is_fetch FOR TESTING RAISING cx_static_check.
    METHODS an_empty_token FOR TESTING RAISING cx_static_check.
    METHODS cookies_are_parsed FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_csrf IMPLEMENTATION.

  METHOD setup.
    CREATE OBJECT mo_session.
    mo_session->ms_session-id = `0123456789abcdef01234567`.
    mo_session->ms_session-token = c_token.
    mo_session->ms_session-user = `DEVELOPER`.
  ENDMETHOD.

  METHOD call.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_header TYPE ihttpnvp.
    ls_request-method = iv_method.
    ls_request-path = c_path.
    IF iv_token IS SUPPLIED.
      ls_header-name = `x-csrf-token`.
      ls_header-value = iv_token.
      APPEND ls_header TO ls_request-headers.
    ENDIF.
    IF iv_cookie IS SUPPLIED.
      ls_header-name = `cookie`.
      ls_header-value = iv_cookie.
      APPEND ls_header TO ls_request-headers.
    ENDIF.
    zcl_osd_adt_handler=>answer( EXPORTING is_request   = ls_request
                                           io_session   = mo_session
                                 IMPORTING es_response  = rs_response
                                           ev_served_by = ev_served_by ).
  ENDMETHOD.

  METHOD headers_named.
    DATA ls_header TYPE ihttpnvp.
    LOOP AT is_response-headers INTO ls_header.
      IF to_lower( ls_header-name ) = iv_name.
        APPEND ls_header-value TO rt_value.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD assert_refused.
    DATA lt_value TYPE string_table.
    cl_abap_unit_assert=>assert_equals( act = is_response-status exp = 403 ).
    cl_abap_unit_assert=>assert_equals( act = is_response-content_type exp = `text/plain; charset=utf-8` ).
    cl_abap_unit_assert=>assert_equals( act = is_response-body exp = `CSRF token validation failed` ).
    lt_value = headers_named( is_response = is_response iv_name = `x-csrf-token` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = `Required`.
    cl_abap_unit_assert=>assert_subrc( ).
  ENDMETHOD.

  METHOD a_get_carries_the_token.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_value TYPE string_table.
    DATA lv_by TYPE string.
    ls_response = call( EXPORTING iv_method = `GET` IMPORTING ev_served_by = lv_by ).
*   the row is the host's: the marker answer, and still the token on it
    cl_abap_unit_assert=>assert_equals( act = lv_by exp = zcl_osd_adt_router=>c_host ).
    lt_value = headers_named( is_response = ls_response iv_name = `x-csrf-token` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = c_token.
    cl_abap_unit_assert=>assert_subrc( ).
*   a safe method asks the session nothing about the token
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked exp = 0 ).
  ENDMETHOD.

  METHOD fetch_is_answered_on_get.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_value TYPE string_table.
    ls_response = call( iv_method = `GET` iv_token = `Fetch` ).
    lt_value = headers_named( is_response = ls_response iv_name = `x-csrf-token` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = c_token.
    cl_abap_unit_assert=>assert_subrc( ).
  ENDMETHOD.

  METHOD fetch_is_answered_on_head.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_value TYPE string_table.
    ls_response = call( iv_method = `HEAD` iv_token = `fetch` ).
    lt_value = headers_named( is_response = ls_response iv_name = `x-csrf-token` ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = c_token.
    cl_abap_unit_assert=>assert_subrc( ).
  ENDMETHOD.

  METHOD a_write_without_token.
    DATA lv_by TYPE string.
    assert_refused( call( EXPORTING iv_method = `POST` IMPORTING ev_served_by = lv_by ) ).
*   refused by ABAP, before the router: the host is not asked to serve it
    cl_abap_unit_assert=>assert_equals( act = lv_by exp = zcl_osd_adt_router=>c_abap ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked exp = 0 ).
  ENDMETHOD.

  METHOD a_write_with_a_wrong_token.
    assert_refused( call( iv_method = `PUT` iv_token = `not-the-token` ) ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked_id exp = `0123456789abcdef01234567` ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked_token exp = `not-the-token` ).
  ENDMETHOD.

  METHOD a_write_asking_fetch.
*   Node refuses it too: fetch is no token, whatever the method
    assert_refused( call( iv_method = `POST` iv_token = `fetch` ) ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked exp = 0 ).
  ENDMETHOD.

  METHOD every_unsafe_method.
    DATA lt_methods TYPE string_table.
    DATA lv_method TYPE string.
    APPEND `POST` TO lt_methods.
    APPEND `PUT` TO lt_methods.
    APPEND `DELETE` TO lt_methods.
    APPEND `PATCH` TO lt_methods.
    APPEND `MERGE` TO lt_methods.
    LOOP AT lt_methods INTO lv_method.
      assert_refused( call( iv_method = lv_method ) ).
      assert_refused( call( iv_method = lv_method iv_token = `wrong` ) ).
    ENDLOOP.
  ENDMETHOD.

  METHOD a_write_with_the_token.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_value TYPE string_table.
    DATA lv_by TYPE string.
    ls_response = call( EXPORTING iv_method = `POST` iv_token = c_token IMPORTING ev_served_by = lv_by ).
*   admitted: past the gate to the router, which hands the path to the host
    cl_abap_unit_assert=>assert_equals( act = lv_by exp = zcl_osd_adt_router=>c_host ).
    cl_abap_unit_assert=>assert_differs( act = ls_response-status exp = 403 ).
    lt_value = headers_named( is_response = ls_response iv_name = `x-csrf-token` ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = c_token.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->mv_asked exp = 1 ).
  ENDMETHOD.

  METHOD safe_methods_are_not_gated.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_methods TYPE string_table.
    DATA lv_method TYPE string.
    APPEND `GET` TO lt_methods.
    APPEND `HEAD` TO lt_methods.
    APPEND `OPTIONS` TO lt_methods.
    LOOP AT lt_methods INTO lv_method.
      ls_response = call( iv_method = lv_method iv_token = `wrong` ).
      cl_abap_unit_assert=>assert_differs( act = ls_response-status exp = 403 ).
    ENDLOOP.
  ENDMETHOD.

  METHOD the_token_is_case_exact.
    assert_refused( call( iv_method = `POST` iv_token = to_upper( c_token ) ) ).
  ENDMETHOD.

  METHOD a_mixed_case_method.
*   a host that hands the method over as sent: Post, delete and Merge are
*   writes all the same
    assert_refused( call( `Post` ) ).
    assert_refused( call( iv_method = `delete` iv_token = `wrong` ) ).
    assert_refused( call( `Merge` ) ).
  ENDMETHOD.

  METHOD cookies_go_first.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    APPEND `sap-contextid=0123456789abcdef01234567; Path=/sap/bc/adt; HttpOnly; SameSite=Strict`
      TO mo_session->mt_cookies.
    APPEND `SAP_SESSIONID_OSD_001=0123456789abcdef01234567; Path=/; HttpOnly; SameSite=Strict`
      TO mo_session->mt_cookies.
    ls_response = call( `GET` ).
*   two Set-Cookie lines, in the session's order, then the token
    READ TABLE ls_response-headers INTO ls_header INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = ls_header-name exp = `set-cookie` ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_header-value exp = `sap-contextid=*` ).
    READ TABLE ls_response-headers INTO ls_header INDEX 2.
    cl_abap_unit_assert=>assert_equals( act = ls_header-name exp = `set-cookie` ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_header-value exp = `SAP_SESSIONID_OSD_001=*` ).
    READ TABLE ls_response-headers INTO ls_header INDEX lines( ls_response-headers ).
    cl_abap_unit_assert=>assert_equals( act = ls_header-name exp = `x-csrf-token` ).
  ENDMETHOD.

  METHOD a_refusal_keeps_cookies.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_value TYPE string_table.
    APPEND `sap-contextid=0123456789abcdef01234567; Path=/sap/bc/adt; HttpOnly; SameSite=Strict`
      TO mo_session->mt_cookies.
    ls_response = call( `DELETE` ).
    assert_refused( ls_response ).
    lt_value = headers_named( is_response = ls_response iv_name = `set-cookie` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
  ENDMETHOD.

  METHOD a_route_header_is_replaced.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    DATA lt_value TYPE string_table.
    ls_header-name = `X-CSRF-Token`.
    ls_header-value = `fetch`.
    APPEND ls_header TO ls_response-headers.
    ls_header-name = `etag`.
    ls_header-value = `"abc"`.
    APPEND ls_header TO ls_response-headers.
    zcl_osd_adt_csrf=>stamp( EXPORTING it_cookies  = mo_session->mt_cookies
                                       iv_token    = c_token
                             CHANGING  cs_response = ls_response ).
    lt_value = headers_named( is_response = ls_response iv_name = `x-csrf-token` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
    READ TABLE lt_value TRANSPORTING NO FIELDS WITH KEY table_line = c_token.
    cl_abap_unit_assert=>assert_subrc( ).
    lt_value = headers_named( is_response = ls_response iv_name = `etag` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_value ) exp = 1 ).
  ENDMETHOD.

  METHOD no_session_no_gate.
*   the mixed phase: the Node middleware gated the request already, and
*   the handler adds no token and refuses nothing
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    ls_request-method = `POST`.
    ls_request-path = c_path.
    zcl_osd_adt_handler=>answer( EXPORTING is_request  = ls_request
                                 IMPORTING es_response = ls_response ).
    cl_abap_unit_assert=>assert_differs( act = ls_response-status exp = 403 ).
    cl_abap_unit_assert=>assert_initial( headers_named( is_response = ls_response iv_name = `x-csrf-token` ) ).
  ENDMETHOD.

  METHOD a_session_that_fails.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lv_by TYPE string.
    mo_session->mv_raise = abap_true.
    ls_response = call( EXPORTING iv_method = `GET` IMPORTING ev_served_by = lv_by ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 500 ).
    cl_abap_unit_assert=>assert_equals( act = lv_by exp = zcl_osd_adt_router=>c_abap ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_response-body exp = `*no session table*` ).
  ENDMETHOD.

  METHOD a_token_that_is_fetch.
*   a session whose token is the word a client reads as "not logged on"
*   is a broken session, not an answer to send
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    mo_session->ms_session-token = `FETCH`.
    ls_response = call( `GET` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 500 ).
    cl_abap_unit_assert=>assert_initial( headers_named( is_response = ls_response iv_name = `x-csrf-token` ) ).
  ENDMETHOD.

  METHOD an_empty_token.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    CLEAR mo_session->ms_session-token.
    ls_response = call( iv_method = `POST` iv_token = `` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 500 ).
  ENDMETHOD.

  METHOD cookies_are_parsed.
    DATA ls_cookie TYPE ihttpnvp.
    call( iv_method = `GET`
          iv_cookie = ` sap-contextid= ; SAP_SESSIONID_OSD_001=abc=def ;novalue; x = 1 ` ).
    cl_abap_unit_assert=>assert_equals( act = lines( mo_session->mt_seen_cookies ) exp = 3 ).
    READ TABLE mo_session->mt_seen_cookies INTO ls_cookie INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = ls_cookie-name exp = `sap-contextid` ).
    cl_abap_unit_assert=>assert_initial( ls_cookie-value ).
    READ TABLE mo_session->mt_seen_cookies INTO ls_cookie INDEX 2.
    cl_abap_unit_assert=>assert_equals( act = ls_cookie-name exp = `SAP_SESSIONID_OSD_001` ).
    cl_abap_unit_assert=>assert_equals( act = ls_cookie-value exp = `abc=def` ).
    READ TABLE mo_session->mt_seen_cookies INTO ls_cookie INDEX 3.
    cl_abap_unit_assert=>assert_equals( act = ls_cookie-name exp = `x` ).
    cl_abap_unit_assert=>assert_equals( act = ls_cookie-value exp = `1` ).
  ENDMETHOD.

ENDCLASS.
