CLASS zcl_osg_regression_kernel DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS evaluate
      IMPORTING
        is_case          TYPE zif_osg_regression=>ty_case
        is_response      TYPE zif_osg_regression=>ty_response
      RETURNING
        VALUE(rs_result) TYPE zif_osg_regression=>ty_verdict.

  PRIVATE SECTION.
    CLASS-METHODS add_finding
      IMPORTING
        iv_kind      TYPE string
        iv_scope     TYPE string
        iv_path      TYPE string
        iv_expected  TYPE string OPTIONAL
        iv_actual    TYPE string OPTIONAL
        iv_message   TYPE string OPTIONAL
      CHANGING
        ct_findings  TYPE zif_osg_regression=>tt_findings.

    CLASS-METHODS header_value
      IMPORTING
        it_headers      TYPE zif_osg_regression=>tt_headers
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.

    CLASS-METHODS media_type
      IMPORTING
        iv_value       TYPE string
      RETURNING
        VALUE(rv_type) TYPE string.
ENDCLASS.

CLASS zcl_osg_regression_kernel IMPLEMENTATION.
  METHOD add_finding.
    DATA ls_finding TYPE zif_osg_regression=>ty_finding.
    ls_finding-kind = iv_kind.
    ls_finding-scope = iv_scope.
    ls_finding-path = iv_path.
    ls_finding-expected = iv_expected.
    ls_finding-actual = iv_actual.
    ls_finding-message = iv_message.
    APPEND ls_finding TO ct_findings.
  ENDMETHOD.

  METHOD header_value.
    DATA ls_header TYPE zif_osg_regression=>ty_header.
    DATA lv_name TYPE string.
    DATA lv_wanted TYPE string.
    lv_wanted = iv_name.
    TRANSLATE lv_wanted TO LOWER CASE.
    LOOP AT it_headers INTO ls_header.
      lv_name = ls_header-name.
      TRANSLATE lv_name TO LOWER CASE.
      IF lv_name = lv_wanted.
        rv_value = ls_header-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD media_type.
    DATA lv_ignored TYPE string.
    SPLIT iv_value AT ';' INTO rv_type lv_ignored.
    CONDENSE rv_type NO-GAPS.
    TRANSLATE rv_type TO LOWER CASE.
  ENDMETHOD.

  METHOD evaluate.
    DATA ls_body TYPE zif_osg_regression=>ty_verdict.
    DATA ls_finding TYPE zif_osg_regression=>ty_finding.
    DATA lv_content_type TYPE string.
    DATA lv_has_error TYPE abap_bool.

    IF is_case-schema_version <> 1 OR is_case-id IS INITIAL
       OR is_case-version IS INITIAL OR is_case-request_method <> 'GET'
       OR is_case-request_path IS INITIAL OR is_case-request_path(1) <> '/'
       OR is_case-expected_status < 100 OR is_case-expected_status > 599
       OR media_type( is_case-request_accept ) <> 'application/json'
       OR media_type( is_case-expected_content_type ) <> 'application/json'
       OR is_case-expected_body_format <> 'json'.
      add_finding(
        EXPORTING iv_kind = zif_osg_regression=>finding_kind-invalid_case
                  iv_scope = 'case' iv_path = ''
                  iv_message = 'unsupported or incomplete RegressionCase v1'
        CHANGING ct_findings = rs_result-findings ).
      rs_result-outcome = zif_osg_regression=>outcome-error.
      RETURN.
    ENDIF.

    IF is_response-status < 100 OR is_response-status > 599
       OR is_response-body_format <> 'json'.
      add_finding(
        EXPORTING iv_kind = zif_osg_regression=>finding_kind-invalid_response
                  iv_scope = 'http' iv_path = ''
                  iv_message = 'malformed response envelope'
        CHANGING ct_findings = rs_result-findings ).
      rs_result-outcome = zif_osg_regression=>outcome-error.
      RETURN.
    ENDIF.

    IF is_response-status <> is_case-expected_status.
      add_finding(
        EXPORTING iv_kind = zif_osg_regression=>finding_kind-value_mismatch
                  iv_scope = 'http' iv_path = '/status'
                  iv_expected = |{ is_case-expected_status }|
                  iv_actual = |{ is_response-status }|
        CHANGING ct_findings = rs_result-findings ).
    ENDIF.

    lv_content_type = header_value(
      it_headers = is_response-headers iv_name = 'content-type' ).
    IF media_type( lv_content_type ) <> media_type( is_case-expected_content_type ).
      add_finding(
        EXPORTING iv_kind = zif_osg_regression=>finding_kind-value_mismatch
                  iv_scope = 'http' iv_path = '/headers/content-type'
                  iv_expected = media_type( is_case-expected_content_type )
                  iv_actual = media_type( lv_content_type )
        CHANGING ct_findings = rs_result-findings ).
    ENDIF.

    ls_body = zcl_osg_json_matcher=>match(
      iv_expected = is_case-expected_json
      iv_actual   = is_response-body_json
      it_masks    = is_case-masks ).
    LOOP AT ls_body-findings INTO ls_finding.
      APPEND ls_finding TO rs_result-findings.
    ENDLOOP.
    IF ls_body-outcome = zif_osg_regression=>outcome-error.
      lv_has_error = abap_true.
    ENDIF.

    SORT rs_result-findings BY scope path kind.
    IF lv_has_error = abap_true.
      rs_result-outcome = zif_osg_regression=>outcome-error.
    ELSEIF rs_result-findings IS INITIAL.
      rs_result-outcome = zif_osg_regression=>outcome-passed.
    ELSE.
      rs_result-outcome = zif_osg_regression=>outcome-failed.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
