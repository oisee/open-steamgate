CLASS ltcl_batch_report DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS supplied_then_default FOR TESTING.
    METHODS unknown_report_is_explicit FOR TESTING.
    METHODS unsupported_report_is_explicit FOR TESTING.
    METHODS unknown_selection_is_rejected FOR TESTING.
    METHODS unfinished_flow_is_reported FOR TESTING.
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
ENDCLASS.
