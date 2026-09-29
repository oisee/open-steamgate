CLASS ltcl_batch_report DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    TYPES ty_numbers TYPE RANGE OF i.
    METHODS supplied_then_default FOR TESTING.
    METHODS unknown_report_is_explicit FOR TESTING.
    METHODS unsupported_report_is_explicit FOR TESTING.
    METHODS unknown_selection_is_rejected FOR TESTING.
    METHODS unfinished_flow_is_reported FOR TESTING.
    METHODS leave_program_completes FOR TESTING.
    METHODS static_submit_returns FOR TESTING.
    METHODS static_submit_fails_loudly FOR TESTING.
    METHODS static_submit_passes_a_range FOR TESTING.
    METHODS static_submit_range_is_checked FOR TESTING.
    METHODS job_submit_checks_registry FOR TESTING.
    METHODS context_is_per_run FOR TESTING.
ENDCLASS.

CLASS ltcl_batch_report IMPLEMENTATION.
  METHOD supplied_then_default.
    DATA lt_input TYPE zif_gg_selection_screen_types=>ty_values.
    DATA ls_first TYPE zcl_osd_batch_report=>ty_result.
    DATA ls_second TYPE zcl_osd_batch_report=>ty_result.

    INSERT VALUE #( name = 'P_DATE' value = '20251231' ) INTO TABLE lt_input.
    ls_first = zcl_osd_batch_report=>run(
      iv_program = 'ZGG_EX_012'
      it_input = lt_input ).
    cl_abap_unit_assert=>assert_equals( act = ls_first-status exp = 'COMPLETED' ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_first-lines ) exp = 1 ).
    FIND '20251231' IN ls_first-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).

*   A fresh report object and host session must use INITIALIZATION again.
    ls_second = zcl_osd_batch_report=>run( iv_program = 'zgg_ex_012' ).
    cl_abap_unit_assert=>assert_equals( act = ls_second-status exp = 'COMPLETED' ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_second-lines ) exp = 1 ).
    FIND '20260101' IN ls_second-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.

  METHOD unknown_report_is_explicit.
    DATA(ls_result) = zcl_osd_batch_report=>run( iv_program = 'Z_NO_SUCH_REPORT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'UNKNOWN' ).
    cl_abap_unit_assert=>assert_initial( ls_result-lines ).
  ENDMETHOD.

  METHOD unsupported_report_is_explicit.
*   This report is present in the tree but its derived class name exceeds
*   ABAP's 30-character limit; it must not be mistaken for an unknown name.
    DATA(ls_result) = zcl_osd_batch_report=>run( iv_program = 'ZOSD_TEST_DEMO_PLAIN' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'UNSUPPORTED' ).
    cl_abap_unit_assert=>assert_initial( ls_result-lines ).
  ENDMETHOD.

  METHOD unknown_selection_is_rejected.
    DATA lt_input TYPE zif_gg_selection_screen_types=>ty_values.
    INSERT VALUE #( name = 'P_DTAE' value = '20251231' ) INTO TABLE lt_input.
    DATA(ls_result) = zcl_osd_batch_report=>run(
      iv_program = 'ZGG_EX_012'
      it_input = lt_input ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'INVALID_INPUT' ).
    cl_abap_unit_assert=>assert_initial( ls_result-lines ).
  ENDMETHOD.

  METHOD unfinished_flow_is_reported.
    DATA ls_host TYPE zcl_gg_host=>ty_result.
    ls_host-navigation-kind = 'SUBMIT'.
    ls_host-navigation-target = 'Z_OTHER'.
    DATA(ls_result) = zcl_osd_batch_report=>result_of( ls_host ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'INCOMPLETE' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-navigation-target exp = 'Z_OTHER' ).

    CLEAR ls_host.
    ls_host-terminal = 'LEAVE TO TRANSACTION'.
    ls_result = zcl_osd_batch_report=>result_of( ls_host ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'INCOMPLETE' ).
  ENDMETHOD.

  METHOD leave_program_completes.
    DATA ls_host TYPE zcl_gg_host=>ty_result.
    APPEND 'before exit' TO ls_host-lines.
    ls_host-terminal = 'LEAVE PROGRAM'.
    ls_host-navigation-kind = zcx_gg_control_flow=>kind_leave_program.
    DATA(ls_result) = zcl_osd_batch_report=>result_of( ls_host ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'COMPLETED' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-lines[ 1 ] exp = 'before exit' ).

*   An inconsistent navigation is still incomplete, even with the same text.
    ls_host-navigation-kind = zcx_gg_control_flow=>kind_submit.
    ls_result = zcl_osd_batch_report=>result_of( ls_host ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'INCOMPLETE' ).
  ENDMETHOD.

  METHOD static_submit_returns.
    DATA lv_date TYPE d VALUE '20251231'.
    SUBMIT zgg_ex_012 WITH p_date = lv_date AND RETURN.
    SUBMIT zosd_sub_ctx AND RETURN.
  ENDMETHOD.

  METHOD static_submit_passes_a_range.
* I EQ rows only: the runtime's IN handles I EQ, E EQ and I CP and throws
* for BT and the rest (ANORMALIES, runtime-in-options). What this proves is
* that the range reaches the report, which the lowering is responsible for.
    DATA lt_range TYPE ty_numbers.
    DATA ls_range LIKE LINE OF lt_range.
    ls_range-sign = 'I'.
    ls_range-option = 'EQ'.
    ls_range-low = 3.
    APPEND ls_range TO lt_range.
    ls_range-low = 5.
    APPEND ls_range TO lt_range.
* two of 1 to 10, checked inside the report
    SUBMIT zosd_sub_range WITH s_num IN lt_range WITH p_exp = 2 AND RETURN.
  ENDMETHOD.

  METHOD static_submit_range_is_checked.
* the same report with a wrong expectation must fail, or the test above
* could not tell a range from no range at all (no range admits all ten)
    DATA lt_range TYPE ty_numbers.
    DATA ls_range LIKE LINE OF lt_range.
    ls_range-sign = 'I'.
    ls_range-option = 'EQ'.
    ls_range-low = 7.
    APPEND ls_range TO lt_range.
    TRY.
        SUBMIT zosd_sub_range WITH s_num IN lt_range WITH p_exp = 10 AND RETURN.
        cl_abap_unit_assert=>fail( 'a range of one value must not admit all ten' ).
      CATCH zcx_osd_submit.
    ENDTRY.
  ENDMETHOD.

  METHOD static_submit_fails_loudly.
    TRY.
        SUBMIT z_no_such_report AND RETURN.
        cl_abap_unit_assert=>fail( 'unknown report must not be silently skipped' ).
      CATCH zcx_osd_submit INTO DATA(lx_submit).
        FIND 'UNKNOWN' IN lx_submit->detail.
        cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
        FIND 'UNKNOWN' IN lx_submit->get_text( ).
        cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    ENDTRY.
  ENDMETHOD.

  METHOD job_submit_checks_registry.
    TRY.
        zcl_osd_batch_report=>submit_via_job(
          iv_program = 'Z_NO_SUCH_REPORT'
          iv_jobname = 'TEST' iv_jobcount = '00000001' iv_authcknam = sy-uname ).
        cl_abap_unit_assert=>fail( 'unknown job report must be rejected' ).
      CATCH zcx_osd_submit INTO DATA(lx_submit).
        FIND 'program_missing' IN lx_submit->detail.
        cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    ENDTRY.
  ENDMETHOD.

  METHOD context_is_per_run.
    DATA lt_input TYPE zif_gg_selection_screen_types=>ty_values.
    INSERT VALUE #( name = 'P_VALUE' value = 'SUPPLIED' ) INTO TABLE lt_input.
    DATA(ls_batch) = zcl_osd_batch_report=>run(
      iv_program = 'ZOSD_SUB_CTX'
      it_input = lt_input
      iv_batch = abap_true ).
    DATA(ls_dialog) = zcl_osd_batch_report=>run(
      iv_program = 'ZOSD_SUB_CTX'
      iv_batch = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = ls_batch-status exp = 'COMPLETED' ).
    cl_abap_unit_assert=>assert_equals( act = ls_dialog-status exp = 'COMPLETED' ).
    FIND 'BATCH' IN ls_batch-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    FIND 'ZOSD_SUB_CTX' IN ls_batch-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    FIND 'SUPPLIED' IN ls_batch-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    FIND 'DIALOG' IN ls_dialog-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    FIND 'DEFAULT' IN ls_dialog-lines[ 1 ].
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
ENDCLASS.
