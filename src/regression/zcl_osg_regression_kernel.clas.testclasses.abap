CLASS ltcl_osg_regression_kernel DEFINITION FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS make_case RETURNING VALUE(rs_case) TYPE zif_osg_regression=>ty_case.
    METHODS make_response RETURNING VALUE(rs_response) TYPE zif_osg_regression=>ty_response.
    METHODS complete_case_passes FOR TESTING.
    METHODS status_mismatch_is_http FOR TESTING.
    METHODS media_parameters_are_ignored FOR TESTING.
    METHODS malformed_response_is_error FOR TESTING.
ENDCLASS.

CLASS ltcl_osg_regression_kernel IMPLEMENTATION.
  METHOD make_case.
    rs_case-schema_version = 1.
    rs_case-id = 'gw1.synthetic.read'.
    rs_case-version = 'fixture-v1'.
    rs_case-description = 'Synthetic read'.
    rs_case-destination = 'DEMO'.
    rs_case-request_method = 'GET'.
    rs_case-request_path = '/sap/opu/odata/sap/ZDEMO/EntitySet'.
    rs_case-request_accept = 'application/json'.
    rs_case-requested_mode = 'replay'.
    rs_case-timeout_ms = 10000.
    rs_case-session_mode = 'isolated'.
    rs_case-expected_status = 200.
    rs_case-expected_content_type = 'application/json'.
    rs_case-expected_body_format = 'json'.
    rs_case-expected_json = '{"d":{"Seats":2}}'.
  ENDMETHOD.

  METHOD make_response.
    DATA ls_header TYPE zif_osg_regression=>ty_header.
    rs_response-status = 200.
    ls_header-name = 'Content-Type'.
    ls_header-value = 'application/json;charset=utf-8'.
    APPEND ls_header TO rs_response-headers.
    rs_response-body_format = 'json'.
    rs_response-body_json = '{"d":{"Seats":2}}'.
  ENDMETHOD.

  METHOD complete_case_passes.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_regression_kernel=>evaluate(
      is_case = make_case( ) is_response = make_response( ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-passed act = ls_result-outcome ).
  ENDMETHOD.

  METHOD status_mismatch_is_http.
    DATA ls_response TYPE zif_osg_regression=>ty_response.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_response = make_response( ).
    ls_response-status = 404.
    ls_result = zcl_osg_regression_kernel=>evaluate(
      is_case = make_case( ) is_response = ls_response ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY scope = 'http' path = '/status'.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD media_parameters_are_ignored.
    DATA ls_response TYPE zif_osg_regression=>ty_response.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_response = make_response( ).
    ls_result = zcl_osg_regression_kernel=>evaluate(
      is_case = make_case( ) is_response = ls_response ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-passed act = ls_result-outcome ).
  ENDMETHOD.

  METHOD malformed_response_is_error.
    DATA ls_response TYPE zif_osg_regression=>ty_response.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_response = make_response( ).
    ls_response-status = 0.
    ls_result = zcl_osg_regression_kernel=>evaluate(
      is_case = make_case( ) is_response = ls_response ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-error act = ls_result-outcome ).
  ENDMETHOD.
ENDCLASS.
