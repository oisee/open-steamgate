CLASS ltcl_osg_json_matcher DEFINITION FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS object_order FOR TESTING.
    METHODS missing_is_not_null FOR TESTING.
    METHODS number_is_not_string FOR TESTING.
    METHODS arrays_are_ordered FOR TESTING.
    METHODS pointer_is_rfc6901 FOR TESTING.
    METHODS exact_mask_passes FOR TESTING.
    METHODS stale_mask_is_error FOR TESTING.
    METHODS overlap_mask_is_error FOR TESTING.
    METHODS invalid_json_is_error FOR TESTING.
    METHODS empty_container_is_present FOR TESTING.
ENDCLASS.

CLASS ltcl_osg_json_matcher IMPLEMENTATION.
  METHOD object_order.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"a":1,"b":{"x":true,"y":null}}'
      iv_actual   = '{"b":{"y":null,"x":true},"a":1}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-passed act = ls_result-outcome ).
    cl_abap_unit_assert=>assert_initial( ls_result-findings ).
  ENDMETHOD.

  METHOD missing_is_not_null.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"value":null}'
      iv_actual   = '{}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/value' kind = zif_osg_regression=>finding_kind-missing.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD number_is_not_string.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"value":2}'
      iv_actual   = '{"value":"2"}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/value' kind = zif_osg_regression=>finding_kind-type_mismatch.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD arrays_are_ordered.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"values":[1,1,2]}'
      iv_actual   = '{"values":[1,2,1]}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/values/1' kind = zif_osg_regression=>finding_kind-value_mismatch.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD pointer_is_rfc6901.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"a/b":{"~key":1}}'
      iv_actual   = '{"a/b":{"~key":2}}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/a~1b/~0key' kind = zif_osg_regression=>finding_kind-value_mismatch.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD exact_mask_passes.
    DATA lt_masks TYPE zif_osg_regression=>tt_path_rules.
    DATA ls_mask TYPE zif_osg_regression=>ty_path_rule.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_mask-path = '/d/ObservedAt'.
    ls_mask-reason = 'synthetic clock'.
    APPEND ls_mask TO lt_masks.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"d":{"Seats":2,"ObservedAt":"old"}}'
      iv_actual   = '{"d":{"ObservedAt":"new","Seats":2}}'
      it_masks    = lt_masks ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-passed act = ls_result-outcome ).
  ENDMETHOD.

  METHOD stale_mask_is_error.
    DATA lt_masks TYPE zif_osg_regression=>tt_path_rules.
    DATA ls_mask TYPE zif_osg_regression=>ty_path_rule.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_mask-path = '/missing'.
    ls_mask-reason = 'stale on purpose'.
    APPEND ls_mask TO lt_masks.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"value":1}' iv_actual = '{"value":1}' it_masks = lt_masks ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-error act = ls_result-outcome ).
  ENDMETHOD.

  METHOD overlap_mask_is_error.
    DATA lt_masks TYPE zif_osg_regression=>tt_path_rules.
    DATA ls_mask TYPE zif_osg_regression=>ty_path_rule.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_mask-path = '/d'.
    ls_mask-reason = 'parent'.
    APPEND ls_mask TO lt_masks.
    ls_mask-path = '/d/value'.
    ls_mask-reason = 'child'.
    APPEND ls_mask TO lt_masks.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"d":{"value":1}}'
      iv_actual   = '{"d":{"value":2}}'
      it_masks    = lt_masks ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-error act = ls_result-outcome ).
  ENDMETHOD.

  METHOD invalid_json_is_error.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"value":1}' iv_actual = '{"value":' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-error act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/actual' kind = zif_osg_regression=>finding_kind-invalid_json.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.

  METHOD empty_container_is_present.
    DATA ls_result TYPE zif_osg_regression=>ty_verdict.
    ls_result = zcl_osg_json_matcher=>match(
      iv_expected = '{"value":[]}' iv_actual = '{}' ).
    cl_abap_unit_assert=>assert_equals(
      exp = zif_osg_regression=>outcome-failed act = ls_result-outcome ).
    READ TABLE ls_result-findings TRANSPORTING NO FIELDS
      WITH KEY path = '/value' kind = zif_osg_regression=>finding_kind-missing.
    cl_abap_unit_assert=>assert_subrc( exp = 0 ).
  ENDMETHOD.
ENDCLASS.
