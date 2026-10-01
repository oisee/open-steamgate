* Run after transpiling this class and ZOSD_L2_CARGO from src/l2demo.
CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS aggregate FOR TESTING.
    METHODS packed_text FOR TESTING.
    METHODS teardown.
ENDCLASS.

CLASS ltcl_probe IMPLEMENTATION.
  METHOD teardown.
    DELETE FROM zosd_l2_cargo WHERE cargo_id LIKE 'P%'.
  ENDMETHOD.

  METHOD aggregate.
    DATA ls_cargo TYPE zosd_l2_cargo.
    DATA ls_expected TYPE zcl_l2_aggregate_probe=>ty_result.
    DATA lt_actual TYPE zcl_l2_aggregate_probe=>ty_results.
    DATA lt_expected TYPE zcl_l2_aggregate_probe=>ty_results.
    ls_cargo-mandt = sy-mandt.
    ls_cargo-cargo_id = 'P00001'.
    ls_cargo-ship_id = 'P001'.
    ls_cargo-weight = '1.25'.
    INSERT zosd_l2_cargo FROM ls_cargo.
    ls_cargo-cargo_id = 'P00002'.
    ls_cargo-weight = '2.50'.
    INSERT zosd_l2_cargo FROM ls_cargo.
    ls_cargo-cargo_id = 'P00003'.
    ls_cargo-ship_id = 'P002'.
    ls_cargo-weight = '0.75'.
    INSERT zosd_l2_cargo FROM ls_cargo.
    lt_actual = zcl_l2_aggregate_probe=>aggregate( ).
    ls_expected-ship_id = 'P001'.
    ls_expected-total = '3.75'.
    ls_expected-largest = '2.50'.
    APPEND ls_expected TO lt_expected.
    ls_expected-ship_id = 'P002'.
    ls_expected-total = '0.75'.
    ls_expected-largest = '0.75'.
    APPEND ls_expected TO lt_expected.
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
  ENDMETHOD.

  METHOD packed_text.
    DATA lt_actual TYPE string_table.
    DATA lt_expected TYPE string_table.
    lt_actual = zcl_l2_aggregate_probe=>packed_text( ).
    APPEND `10.50` TO lt_expected.
    APPEND `10.5` TO lt_expected.
    APPEND `10.50-` TO lt_expected.
    APPEND `-10.5` TO lt_expected.
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
  ENDMETHOD.

ENDCLASS.
