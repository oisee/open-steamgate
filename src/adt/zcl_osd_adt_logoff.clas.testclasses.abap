CLASS ltcl_logoff DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS id_guard FOR TESTING.
    METHODS guarded_route FOR TESTING RAISING cx_static_check.
    METHODS setup.
    METHODS teardown.
    METHODS precedence FOR TESTING RAISING cx_static_check.
    METHODS empty_context FOR TESTING RAISING cx_static_check.
    METHODS failing_identity FOR TESTING RAISING cx_static_check.
    METHODS cookie_end IMPORTING iv_empty TYPE abap_bool RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_logoff IMPLEMENTATION.
  METHOD setup.
    WRITE '@KERNEL this.savedIdentity = abap.Classes.ZCL_OSD_ADT_HOST.identity;'.
    WRITE '@KERNEL abap.Classes.ZCL_OSD_ADT_HOST.identity = async () => {'.
    WRITE '@KERNEL const row = abap.Classes.ZCL_OSD_ADT_HOST.METHODS.IDENTITY.parameters.RS_IDENTITY.type();'.
    WRITE '@KERNEL row.get().system_id.set("OSD"); row.get().client.set("001"); return row; };'.
    zcl_osd_adt_session_mem=>reset( ).
  ENDMETHOD.
  METHOD teardown.
    zcl_osd_adt_session_mem=>reset( ).
    WRITE '@KERNEL abap.Classes.ZCL_OSD_ADT_HOST.identity = this.savedIdentity;'.
  ENDMETHOD.
  METHOD id_guard.
    cl_abap_unit_assert=>assert_true( zcl_osd_adt_logoff=>valid_id( `0123456789abcdef01234567` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_logoff=>valid_id( `0123456789ABCDEF01234567` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_logoff=>valid_id( `0123456789abcdef0123456` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_logoff=>valid_id( `0123456789abcdef012345678` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_logoff=>valid_id( `0123456789abcdef0123456g` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_logoff=>valid_id( `` ) ).
  ENDMETHOD.
  METHOD guarded_route.
    DATA lo_route TYPE REF TO zcl_osd_adt_logoff.
    DATA lt_ids TYPE string_table.
    DATA lv_id TYPE string.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    CREATE OBJECT lo_route.
    APPEND `` TO lt_ids.
    APPEND `foreign-owner` TO lt_ids.
    APPEND `0123456789ABCDEF01234567` TO lt_ids.
    APPEND `0123456789abcdef0123456` TO lt_ids.
    APPEND `0123456789abcdef012345678` TO lt_ids.
    LOOP AT lt_ids INTO lv_id.
      CLEAR ls_request.
*     No session provider: an attempted END or RESOLVE would dump.
      ls_header-name = `cookie`.
      ls_header-value = `sap-contextid=` && lv_id.
      APPEND ls_header TO ls_request-headers.
      ls_response = lo_route->zif_osd_adt_route~handle( ls_request ).
      cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
      cl_abap_unit_assert=>assert_initial( ls_response-headers ).
    ENDLOOP.
  ENDMETHOD.
  METHOD cookie_end.
    DATA lo_route TYPE REF TO zcl_osd_adt_logoff.
    DATA lo_mem TYPE REF TO zcl_osd_adt_session_mem.
    DATA li_mem TYPE REF TO zif_osd_adt_session.
    DATA ls_one TYPE zif_osd_adt_session=>ty_session.
    DATA ls_two TYPE zif_osd_adt_session=>ty_session.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    DATA lt_fields TYPE tihttpnvp.
    CREATE OBJECT lo_route.
    CREATE OBJECT lo_mem.
    li_mem = lo_mem.
    ls_one = li_mem->resolve( it_cookies = lt_fields it_headers = lt_fields ).
    ls_two = li_mem->resolve( it_cookies = lt_fields it_headers = lt_fields ).
    ls_request-sessions = li_mem.
    ls_header-name = `cookie`.
    ls_header-value = `sap-contextid=`.
    IF iv_empty = abap_false.
      ls_header-value = ls_header-value && ls_one-id.
    ENDIF.
    ls_header-value = ls_header-value && `; SAP_SESSIONID_OSD_001=` && ls_two-id.
    APPEND ls_header TO ls_request-headers.
    ls_response = lo_route->zif_osd_adt_route~handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = `logged off` ).
    cl_abap_unit_assert=>assert_initial( ls_response-headers ).
    IF iv_empty = abap_true.
      cl_abap_unit_assert=>assert_true( li_mem->token_valid( iv_id = ls_one-id iv_token = ls_one-token ) ).
      cl_abap_unit_assert=>assert_false( li_mem->token_valid( iv_id = ls_two-id iv_token = ls_two-token ) ).
    ELSE.
      cl_abap_unit_assert=>assert_false( li_mem->token_valid( iv_id = ls_one-id iv_token = ls_one-token ) ).
      cl_abap_unit_assert=>assert_true( li_mem->token_valid( iv_id = ls_two-id iv_token = ls_two-token ) ).
    ENDIF.
  ENDMETHOD.
  METHOD precedence.
    cookie_end( abap_false ).
  ENDMETHOD.
  METHOD empty_context.
    cookie_end( abap_true ).
  ENDMETHOD.
  METHOD failing_identity.
*   Resolve the sessions before making the optional host lookup fail.
    DATA lo_route TYPE REF TO zcl_osd_adt_logoff.
    DATA lo_mem TYPE REF TO zcl_osd_adt_session_mem.
    DATA li_mem TYPE REF TO zif_osd_adt_session.
    DATA ls_one TYPE zif_osd_adt_session=>ty_session.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    DATA lt_fields TYPE tihttpnvp.
    CREATE OBJECT lo_route.
    CREATE OBJECT lo_mem.
    li_mem = lo_mem.
    ls_one = li_mem->resolve( it_cookies = lt_fields it_headers = lt_fields ).
    ls_request-sessions = li_mem.
    ls_header-name = `cookie`.
    ls_header-value = `sap-contextid=` && ls_one-id.
    APPEND ls_header TO ls_request-headers.
    WRITE '@KERNEL abap.Classes.ZCL_OSD_ADT_HOST.identity = async () => { throw new Error("identity unavailable"); };'.
    ls_response = lo_route->zif_osd_adt_route~handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = `logged off` ).
    cl_abap_unit_assert=>assert_false( li_mem->token_valid( iv_id = ls_one-id iv_token = ls_one-token ) ).
  ENDMETHOD.
ENDCLASS.
