"! Unit fixture replaces only IDENTITY and restores it in teardown.
"! Parity tests exercise the real host destination in dialog steps.
CLASS ltcl_session DEFINITION FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS FINAL.
  PRIVATE SECTION.
    DATA mo_session TYPE REF TO zcl_osd_adt_session.
    DATA mo_api TYPE REF TO zif_osd_adt_session.
    DATA ms_one TYPE zif_osd_adt_session=>ty_session.
    METHODS setup RAISING cx_static_check.
    METHODS teardown.
    METHODS by_cookie
      IMPORTING iv_context TYPE string OPTIONAL iv_session TYPE string OPTIONAL
                iv_state TYPE string OPTIONAL
      RETURNING VALUE(rs_session) TYPE zif_osd_adt_session=>ty_session
      RAISING cx_static_check.
    METHODS open_and_cookies FOR TESTING RAISING cx_static_check.
    METHODS each_cookie FOR TESTING RAISING cx_static_check.
    METHODS context_precedence FOR TESTING RAISING cx_static_check.
    METHODS empty_context FOR TESTING RAISING cx_static_check.
    METHODS expiry_sweeps_all FOR TESTING RAISING cx_static_check.
    METHODS ttl_boundary FOR TESTING RAISING cx_static_check.
    METHODS state_never_unmarks FOR TESTING RAISING cx_static_check.
    METHODS tokens_do_not_touch FOR TESTING RAISING cx_static_check.
    METHODS handles FOR TESTING RAISING cx_static_check.
    METHODS rehydrate FOR TESTING RAISING cx_static_check.
    METHODS logoff FOR TESTING RAISING cx_static_check.
    METHODS context_end FOR TESTING RAISING cx_static_check.
    METHODS holders FOR TESTING RAISING cx_static_check.
    METHODS ended_context_keeps_session FOR TESTING RAISING cx_static_check.
    METHODS throttled_sweep_still_expires FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_session IMPLEMENTATION.
  METHOD setup.
    WRITE '@KERNEL this.savedIdentity = abap.Classes.ZCL_OSD_ADT_HOST.identity;'.
    WRITE '@KERNEL abap.Classes.ZCL_OSD_ADT_HOST.identity = async () => {'.
    WRITE '@KERNEL const row = abap.Classes.ZCL_OSD_ADT_HOST.METHODS.IDENTITY.parameters.RS_IDENTITY.type();'.
    WRITE '@KERNEL for (const [k,v] of Object.entries({system_id:"OSD",client:"001",user_name:"OSD"})) row.get()[k].set(v);'.
    WRITE '@KERNEL return row; };'.
    CREATE OBJECT mo_session EXPORTING iv_ttl_seconds = 10 iv_now = '20261002000000'.
    mo_api = mo_session.
    ms_one = by_cookie( ).
  ENDMETHOD.

  METHOD teardown.
    DATA lt_rows TYPE STANDARD TABLE OF zosd_adt_sess WITH DEFAULT KEY.
    DATA ls_row TYPE zosd_adt_sess.
    DATA lv_id TYPE string.
    SELECT * FROM zosd_adt_sess INTO TABLE lt_rows WHERE mandt = sy-mandt.
    LOOP AT lt_rows INTO ls_row.
      lv_id = ls_row-id.
      mo_api->end( lv_id ).
    ENDLOOP.
    WRITE '@KERNEL abap.Classes.ZCL_OSD_ADT_HOST.identity = this.savedIdentity;'.
  ENDMETHOD.

  METHOD by_cookie.
    DATA lt_cookies TYPE tihttpnvp.
    DATA lt_headers TYPE tihttpnvp.
    DATA ls_field TYPE ihttpnvp.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    ls_identity = zcl_osd_adt_host=>identity( ).
    ls_field-name = `sap-contextid`.
    ls_field-value = iv_context.
    APPEND ls_field TO lt_cookies.
    ls_field-name = |SAP_SESSIONID_{ ls_identity-system_id }_{ ls_identity-client }|.
    ls_field-value = iv_session.
    APPEND ls_field TO lt_cookies.
    ls_field-name = `X-SAP-ADT-SessionType`.
    ls_field-value = iv_state.
    APPEND ls_field TO lt_headers.
    rs_session = mo_api->resolve( it_cookies = lt_cookies it_headers = lt_headers ).
  ENDMETHOD.

  METHOD open_and_cookies.
    DATA lt_cookies TYPE string_table.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    ls_identity = zcl_osd_adt_host=>identity( ).
    cl_abap_unit_assert=>assert_equals( act = strlen( ms_one-id ) exp = 24 ).
    cl_abap_unit_assert=>assert_equals( act = strlen( ms_one-token ) exp = 24 ).
    cl_abap_unit_assert=>assert_differs( act = ms_one-token exp = `fetch` ).
    cl_abap_unit_assert=>assert_equals( act = ms_one-user exp = ls_identity-user_name ).
    cl_abap_unit_assert=>assert_true( ms_one-fresh ).
    lt_cookies = mo_api->cookies( ms_one ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_cookies ) exp = 2 ).
  ENDMETHOD.

  METHOD each_cookie.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    DATA lt_cookies TYPE string_table.
    ls_again = by_cookie( iv_context = ms_one-id ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-id exp = ms_one-id ).
    cl_abap_unit_assert=>assert_false( ls_again-fresh ).
    ls_again = by_cookie( iv_session = ms_one-id ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-token exp = ms_one-token ).
    lt_cookies = mo_api->cookies( ls_again ).
    cl_abap_unit_assert=>assert_initial( lt_cookies ).
  ENDMETHOD.

  METHOD context_precedence.
    DATA ls_two TYPE zif_osd_adt_session=>ty_session.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    ls_two = by_cookie( ).
    ls_again = by_cookie( iv_context = ms_one-id iv_session = ls_two-id ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-id exp = ms_one-id ).
    ls_again = by_cookie( iv_context = `unknown` iv_session = ms_one-id ).
    cl_abap_unit_assert=>assert_true( ls_again-fresh ).
  ENDMETHOD.

  METHOD empty_context.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    ls_again = by_cookie( iv_context = `` iv_session = ms_one-id ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-id exp = ms_one-id ).
    ls_again = by_cookie( ).
    cl_abap_unit_assert=>assert_true( ls_again-fresh ).
  ENDMETHOD.

  METHOD expiry_sweeps_all.
    DATA ls_two TYPE zif_osd_adt_session=>ty_session.
    DATA ls_new TYPE zif_osd_adt_session=>ty_session.
    DATA ls_row TYPE zosd_adt_sess.
    DATA lv_handle TYPE string.
    ls_two = by_cookie( ).
    lv_handle = mo_api->adopt_handle( iv_id = ls_two-id iv_type = `CLAS` iv_name = `ZTEST` ).
    mo_session->set_clock( '20261002000011' ).
    ls_new = by_cookie( iv_context = ms_one-id ).
    cl_abap_unit_assert=>assert_true( ls_new-fresh ).
    SELECT SINGLE * FROM zosd_adt_sess INTO ls_row WHERE mandt = sy-mandt AND id = ls_two-id.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
    cl_abap_unit_assert=>assert_false( mo_api->holds(
      iv_id = ls_two-id iv_handle = lv_handle iv_type = `CLAS` iv_name = `ZTEST` ) ).
  ENDMETHOD.

  METHOD ttl_boundary.
    mo_session->set_clock( '20261002000010' ).
    cl_abap_unit_assert=>assert_true( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
    mo_session->set_clock( '20261002000011' ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
  ENDMETHOD.

  METHOD state_never_unmarks.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    ls_again = by_cookie( iv_context = ms_one-id iv_state = `StAtEfUl` ).
    cl_abap_unit_assert=>assert_true( ls_again-stateful ).
    ls_again = by_cookie( iv_context = ms_one-id iv_state = `stateless` ).
    cl_abap_unit_assert=>assert_true( ls_again-stateful ).
  ENDMETHOD.

  METHOD tokens_do_not_touch.
    DATA ls_row TYPE zosd_adt_sess.
    mo_session->set_clock( '20261002000009' ).
    cl_abap_unit_assert=>assert_true( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = ms_one-id iv_token = `wrong` ) ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = `missing` iv_token = `` ) ).
    mo_session->set_clock( '20261002000011' ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
    SELECT SINGLE * FROM zosd_adt_sess INTO ls_row WHERE mandt = sy-mandt AND id = ms_one-id.
    cl_abap_unit_assert=>assert_equals( act = ls_row-touched exp = '20261002000000' ).
  ENDMETHOD.

  METHOD handles.
    DATA lv_handle TYPE string.
    DATA lv_again TYPE string.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    lv_handle = mo_api->adopt_handle( iv_id = ms_one-id iv_type = `clas` iv_name = `ztest` ).
    lv_again = mo_api->adopt_handle( iv_id = ms_one-id iv_type = `CLAS` iv_name = `ZTEST` ).
    cl_abap_unit_assert=>assert_equals( act = lv_handle exp = lv_again ).
    cl_abap_unit_assert=>assert_equals( act = strlen( lv_handle ) exp = 40 ).
    cl_abap_unit_assert=>assert_true( mo_api->holds(
      iv_id = ms_one-id iv_handle = lv_handle iv_type = `ClAs` iv_name = `Ztest` ) ).
    cl_abap_unit_assert=>assert_false( mo_api->holds(
      iv_id = `other` iv_handle = lv_handle iv_type = `CLAS` iv_name = `ZTEST` ) ).
    mo_api->release_handle( EXPORTING iv_id = ms_one-id iv_handle = lv_handle
                           IMPORTING ev_type = lv_type ev_name = lv_name ).
    cl_abap_unit_assert=>assert_equals( act = lv_type exp = `clas` ).
    cl_abap_unit_assert=>assert_equals( act = lv_name exp = `ztest` ).
    mo_api->release_handle( EXPORTING iv_id = ms_one-id iv_handle = lv_handle
                           IMPORTING ev_type = lv_type ev_name = lv_name ).
    cl_abap_unit_assert=>assert_initial( lv_type ).
    cl_abap_unit_assert=>assert_initial( lv_name ).
  ENDMETHOD.

  METHOD rehydrate.
    DATA lv_handle TYPE string.
    DATA lv_id TYPE string.
    DATA lv_count TYPE i.
    DATA lt_handles TYPE zcl_osd_adt_session=>ty_handles.
    DATA ls_row TYPE zosd_adt_sess.
    ms_one = by_cookie( iv_context = ms_one-id iv_state = `stateful` ).
    lv_id = ms_one-id.
    lv_handle = mo_api->adopt_handle( iv_id = lv_id iv_type = `CLAS` iv_name = `ZCL_B0` ).
*   Model a new process's empty ENQ context without ending the SQL rows.
    zcl_osd_enq_kernel=>end( lv_id ).
    zcl_osd_enq_kernel=>revive( lv_id ).
    lv_count = zcl_osd_adt_session=>rehydrate( lv_id ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
    lv_count = zcl_osd_adt_session=>rehydrate( lv_id ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
    lt_handles = mo_session->handles( lv_id ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_handles ) exp = 1 ).
    cl_abap_unit_assert=>assert_true( mo_api->holds( iv_id = lv_id iv_handle = lv_handle
      iv_type = `CLAS` iv_name = `ZCL_B0` ) ).
    ls_row = mo_session->peek( lv_id ).
    cl_abap_unit_assert=>assert_equals( act = ls_row-token exp = ms_one-token ).
  ENDMETHOD.

  METHOD logoff.
    DATA lv_handle TYPE string.
    lv_handle = mo_api->adopt_handle( iv_id = ms_one-id iv_type = `CLAS` iv_name = `ZTEST` ).
    mo_api->end( ms_one-id ).
    mo_api->end( ms_one-id ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
    cl_abap_unit_assert=>assert_false( mo_api->holds(
      iv_id = ms_one-id iv_handle = lv_handle iv_type = `CLAS` iv_name = `ZTEST` ) ).
  ENDMETHOD.

  METHOD context_end.
    DATA lv_handle TYPE string.
    lv_handle = mo_api->adopt_handle( iv_id = ms_one-id iv_type = `CLAS` iv_name = `ZTEST` ).
    mo_api->enq_context_ended( ms_one-id ).
    cl_abap_unit_assert=>assert_false( mo_api->holds(
      iv_id = ms_one-id iv_handle = lv_handle iv_type = `CLAS` iv_name = `ZTEST` ) ).
    cl_abap_unit_assert=>assert_true( mo_api->token_valid( iv_id = ms_one-id iv_token = ms_one-token ) ).
  ENDMETHOD.

  METHOD ended_context_keeps_session.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    DATA lv_handle TYPE string.
    ls_again = by_cookie( iv_context = ms_one-id iv_state = `stateful` ).
    lv_handle = mo_api->adopt_handle( iv_id = ms_one-id iv_type = `CLAS` iv_name = `ZENDED` ).
    zcl_osd_enq_kernel=>end( ms_one-id ).
*   the lock server ended the context while the row stays: the session and
*   its token stay, its handles go with the locks
    ls_again = by_cookie( iv_context = ms_one-id ).
    cl_abap_unit_assert=>assert_false( ls_again-fresh ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-id exp = ms_one-id ).
    cl_abap_unit_assert=>assert_equals( act = ls_again-token exp = ms_one-token ).
    cl_abap_unit_assert=>assert_false( mo_api->holds(
      iv_id = ms_one-id iv_handle = lv_handle iv_type = `CLAS` iv_name = `ZENDED` ) ).
  ENDMETHOD.

  METHOD holders.
    cl_abap_unit_assert=>assert_true( mo_api->alive( ms_one-id ) ).
    mo_session->set_clock( '20261002000009' ).
    cl_abap_unit_assert=>assert_true( mo_api->alive( ms_one-id ) ).
    mo_session->set_clock( '20261002000011' ).
    cl_abap_unit_assert=>assert_false( mo_api->alive( ms_one-id ) ).
    cl_abap_unit_assert=>assert_false( mo_api->alive( ms_one-id ) ).
    cl_abap_unit_assert=>assert_true( mo_api->alive( `adt:foreign:unknown` ) ).
    cl_abap_unit_assert=>assert_true( mo_api->alive( `foreign` ) ).
  ENDMETHOD.
  METHOD throttled_sweep_still_expires.
    DATA ls_stale TYPE zosd_adt_sess.
    DATA ls_other TYPE zif_osd_adt_session=>ty_session.
    DATA ls_again TYPE zif_osd_adt_session=>ty_session.
    DATA lv_stale TYPE string VALUE `aaaaaaaaaaaaaaaaaaaaaaaa`.
*   setup's resolve swept at the clock's time; a row that expired meanwhile
*   is not swept by the next resolve in the same interval ...
    ls_stale-mandt = sy-mandt.
    ls_stale-id = lv_stale.
    ls_stale-token = `stale`.
    ls_stale-username = `OSD`.
    ls_stale-created = '20261001000000'.
    ls_stale-touched = '20261001000000'.
    INSERT zosd_adt_sess FROM ls_stale.
    ls_other = by_cookie( iv_context = ms_one-id ).
    cl_abap_unit_assert=>assert_equals( act = mo_session->peek( lv_stale )-id exp = lv_stale ).
*   ... but it is gone to the one who asks for it: a fresh session opens
    ls_again = by_cookie( iv_context = lv_stale ).
    cl_abap_unit_assert=>assert_true( ls_again-fresh ).
    cl_abap_unit_assert=>assert_differs( act = ls_again-id exp = lv_stale ).
    cl_abap_unit_assert=>assert_initial( mo_session->peek( lv_stale ) ).
    cl_abap_unit_assert=>assert_false( mo_api->token_valid( iv_id = lv_stale iv_token = `stale` ) ).
  ENDMETHOD.
ENDCLASS.
