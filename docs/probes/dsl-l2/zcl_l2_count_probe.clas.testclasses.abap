CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS aggregate FOR TESTING.
ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION.
  METHOD aggregate.
    DATA ls_ship TYPE zosd_l2_ship.
    DATA ls_voy TYPE zosd_l2_voy.
    DATA lt_result TYPE string_table.
    DATA lt_expected TYPE string_table.
    ls_ship-mandt = sy-mandt.
    ls_ship-ship_id = 'P001'.
    INSERT zosd_l2_ship FROM ls_ship.
    ls_ship-ship_id = 'P002'.
    INSERT zosd_l2_ship FROM ls_ship.
    ls_voy-mandt = sy-mandt.
    ls_voy-ship_id = 'P001'.
    ls_voy-voyage_id = 'P00001'.
    INSERT zosd_l2_voy FROM ls_voy.
    ls_voy-voyage_id = 'P00002'.
    INSERT zosd_l2_voy FROM ls_voy.
    ls_voy-voyage_id = 'P00003'.
    INSERT zosd_l2_voy FROM ls_voy.
    ls_voy-ship_id = 'P002'.
    ls_voy-voyage_id = 'P00004'.
    INSERT zosd_l2_voy FROM ls_voy.
    lt_result = zcl_l2_count_probe=>check( ).
    DELETE FROM zosd_l2_voy WHERE voyage_id LIKE 'P%'.
    DELETE FROM zosd_l2_ship WHERE ship_id LIKE 'P%'.
    APPEND `P001:3` TO lt_expected.
    cl_abap_unit_assert=>assert_equals( act = lt_result exp = lt_expected ).
  ENDMETHOD.
ENDCLASS.
