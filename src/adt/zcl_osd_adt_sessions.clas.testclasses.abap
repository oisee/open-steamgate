CLASS ltcl_sessions DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS security_vector FOR TESTING.
    METHODS poll FOR TESTING RAISING cx_static_check.
    METHODS delete_lower FOR TESTING RAISING cx_static_check.
    METHODS delete_other FOR TESTING RAISING cx_static_check.
    METHODS delete_raw FOR TESTING RAISING cx_static_check.
    METHODS deletion IMPORTING iv_kind TYPE string RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_sessions IMPLEMENTATION.
  METHOD security_vector.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_adt_sessions=>security_id( `0123456789abcdef01234567` )
      exp = `8865FEA8EDB697169AC2B4F5E6339E16` ).
  ENDMETHOD.
  METHOD poll.
    DATA lo_route TYPE REF TO zcl_osd_adt_sessions.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    CREATE OBJECT lo_route.
    ls_request-method = `GET`.
    ls_request-session-id = `0123456789abcdef01234567`.
    ls_response = lo_route->zif_osd_adt_route~handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.adt.core.http.session.v3+xml; charset=utf-8` ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `8865FEA8EDB697169AC2B4F5E6339E16` ) ).
    cl_abap_unit_assert=>assert_initial( ls_response-headers ).
  ENDMETHOD.
  METHOD deletion.
    DATA lo_route TYPE REF TO zcl_osd_adt_sessions.
    DATA lo_mem TYPE REF TO zcl_osd_adt_session_mem.
    DATA li_mem TYPE REF TO zif_osd_adt_session.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lt_fields TYPE tihttpnvp.
    CREATE OBJECT lo_route.
    CREATE OBJECT lo_mem.
    li_mem = lo_mem.
    zcl_osd_adt_session_mem=>reset( ).
    ls_request-session = li_mem->resolve( it_cookies = lt_fields it_headers = lt_fields ).
    ls_request-sessions = li_mem.
    ls_request-method = `DELETE`.
    ls_param-name = `id`.
    ls_param-value = iv_kind.
    IF iv_kind = `lower`.
      ls_param-value = to_lower( zcl_osd_adt_sessions=>security_id( ls_request-session-id ) ).
    ELSEIF iv_kind = `raw`.
      ls_param-value = ls_request-session-id.
    ENDIF.
    APPEND ls_param TO ls_request-params.
    ls_response = lo_route->zif_osd_adt_route~handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_initial( ls_response-body ).
    cl_abap_unit_assert=>assert_initial( ls_response-content_type ).
    IF iv_kind = `lower`.
      cl_abap_unit_assert=>assert_false(
        li_mem->token_valid( iv_id = ls_request-session-id iv_token = ls_request-session-token ) ).
    ELSE.
      cl_abap_unit_assert=>assert_true(
        li_mem->token_valid( iv_id = ls_request-session-id iv_token = ls_request-session-token ) ).
    ENDIF.
    zcl_osd_adt_session_mem=>reset( ).
  ENDMETHOD.
  METHOD delete_lower.
    deletion( `lower` ).
  ENDMETHOD.
  METHOD delete_other.
    deletion( `another-security-id` ).
  ENDMETHOD.
  METHOD delete_raw.
    deletion( `raw` ).
  ENDMETHOD.
ENDCLASS.
