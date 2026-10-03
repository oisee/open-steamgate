CLASS ltcl_seed DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS same_seed_same_fleet FOR TESTING.
    METHODS wipe_replaces_the_fleet FOR TESTING.
    METHODS rows_are_in_range FOR TESTING.
ENDCLASS.

CLASS ltcl_seed IMPLEMENTATION.
  METHOD same_seed_same_fleet.
    DATA ls_first TYPE zcl_l3_fleet_seed=>ty_counts.
    DATA ls_second TYPE zcl_l3_fleet_seed=>ty_counts.
    DATA lt_first TYPE STANDARD TABLE OF zosd_l2_voy.
    DATA lt_second TYPE STANDARD TABLE OF zosd_l2_voy.
    ls_first = zcl_l3_fleet_seed=>generate( iv_ships = 30 iv_seed = 7 iv_date = '20261001' ).
    SELECT * FROM zosd_l2_voy INTO TABLE lt_first ORDER BY voyage_id.
    ls_second = zcl_l3_fleet_seed=>generate( iv_ships = 30 iv_seed = 7 iv_date = '20261001' ).
    SELECT * FROM zosd_l2_voy INTO TABLE lt_second ORDER BY voyage_id.
    cl_abap_unit_assert=>assert_equals( act = ls_second exp = ls_first ).
    cl_abap_unit_assert=>assert_equals( act = lt_second exp = lt_first ).
    cl_abap_unit_assert=>assert_equals( act = ls_first-ships exp = 30 ).
    ROLLBACK WORK.
  ENDMETHOD.

  METHOD wipe_replaces_the_fleet.
    DATA lv_count TYPE i.
    zcl_l3_fleet_seed=>generate( iv_ships = 40 iv_seed = 3 iv_date = '20261001' ).
    zcl_l3_fleet_seed=>generate( iv_ships = 5 iv_seed = 3 iv_date = '20261001' ).
    SELECT COUNT(*) FROM zosd_l2_ship INTO lv_count.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 5 ).
    ROLLBACK WORK.
  ENDMETHOD.

  METHOD rows_are_in_range.
    DATA ls_counts TYPE zcl_l3_fleet_seed=>ty_counts.
    DATA lv_count TYPE i.
    ls_counts = zcl_l3_fleet_seed=>generate( iv_ships = 200 iv_seed = 42 iv_date = '20261001' ).
    cl_abap_unit_assert=>assert_number_between( number = ls_counts-voyages lower = 200 upper = 600 ).
    SELECT COUNT(*) FROM zosd_l2_voy INTO lv_count.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = ls_counts-voyages ).
    SELECT COUNT(*) FROM zosd_l2_crew INTO lv_count.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = ls_counts-crew ).
    cl_abap_unit_assert=>assert_number_between( number = lv_count lower = 200 upper = 800 ).
    SELECT COUNT(*) FROM zosd_l2_crew INTO lv_count WHERE role = 'C'.
    cl_abap_unit_assert=>assert_number_between( number = lv_count lower = 50 upper = 200 ).
    SELECT COUNT(*) FROM zosd_l2_cargo INTO lv_count.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = ls_counts-cargo ).
    cl_abap_unit_assert=>assert_number_between( number = lv_count lower = 100 upper = 500 ).
    SELECT COUNT(*) FROM zosd_l2_voy INTO lv_count
      WHERE dep_date < '20260921' OR dep_date > '20261031'.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 ).
    SELECT COUNT(*) FROM zosd_l2_ship INTO lv_count WHERE status = 'M'.
    cl_abap_unit_assert=>assert_number_between( number = lv_count lower = 5 upper = 40 ).
    SELECT COUNT(*) FROM zosd_l2_cargo INTO lv_count WHERE weight > '600.00'.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 ).
    ROLLBACK WORK.
  ENDMETHOD.
ENDCLASS.
