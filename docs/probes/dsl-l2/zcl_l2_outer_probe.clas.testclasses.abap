* The expectations are what a system answers (null of the outer side read as
* the initial value; a WHERE on the right table drops the rows whose right
* side is null); docs/dsl-l2.md "Slice 5" records what this runtime gave.
CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS teardown.
    METHODS outer_eq FOR TESTING.
    METHODS outer_on_literal FOR TESTING.
    METHODS outer_on_greater FOR TESTING.
    METHODS outer_where_right FOR TESTING.
    METHODS two_queries FOR TESTING.
    METHODS collect_sorted FOR TESTING.
    METHODS collect_standard FOR TESTING.
    METHODS crew IMPORTING iv_crew TYPE csequence iv_ship TYPE csequence iv_role TYPE csequence iv_since TYPE d.
ENDCLASS.

CLASS ltcl_probe IMPLEMENTATION.
  METHOD crew.
    DATA ls_crew TYPE zosd_l2_crew.
    ls_crew-mandt = sy-mandt.
    ls_crew-crew_id = iv_crew.
    ls_crew-ship_id = iv_ship.
    ls_crew-role = iv_role.
    ls_crew-since = iv_since.
    INSERT zosd_l2_crew FROM ls_crew.
  ENDMETHOD.

  METHOD setup.
    DATA ls_ship TYPE zosd_l2_ship.
    ls_ship-mandt = sy-mandt.
    " P003 is inserted before P001 and P002: the order is the query's
    ls_ship-ship_id = 'P003'.
    INSERT zosd_l2_ship FROM ls_ship.
    ls_ship-ship_id = 'P001'.
    INSERT zosd_l2_ship FROM ls_ship.
    ls_ship-ship_id = 'P002'.
    INSERT zosd_l2_ship FROM ls_ship.
    crew( iv_crew = 'P00002' iv_ship = 'P001' iv_role = 'K' iv_since = '20261101' ).
    crew( iv_crew = 'P00001' iv_ship = 'P001' iv_role = 'C' iv_since = '20260101' ).
    crew( iv_crew = 'P00003' iv_ship = 'P003' iv_role = 'K' iv_since = '20261201' ).
  ENDMETHOD.

  METHOD teardown.
    DELETE FROM zosd_l2_crew WHERE crew_id LIKE 'P%'.
    DELETE FROM zosd_l2_ship WHERE ship_id LIKE 'P%'.
  ENDMETHOD.

  METHOD outer_eq.
    DATA lt_exp TYPE string_table.
    APPEND `P001:P00001:20260101:` TO lt_exp.
    APPEND `P001:P00002:20261101:` TO lt_exp.
    APPEND `P002::00000000:I` TO lt_exp.
    APPEND `P003:P00003:20261201:` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>outer_eq( ) exp = lt_exp ).
  ENDMETHOD.

  METHOD outer_on_literal.
    DATA lt_exp TYPE string_table.
    APPEND `P001:P00001:20260101:` TO lt_exp.
    APPEND `P002::00000000:I` TO lt_exp.
    APPEND `P003::00000000:I` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>outer_on_literal( ) exp = lt_exp ).
  ENDMETHOD.

  METHOD outer_on_greater.
    DATA lt_exp TYPE string_table.
    APPEND `P001:P00002:20261101:` TO lt_exp.
    APPEND `P002::00000000:I` TO lt_exp.
    APPEND `P003:P00003:20261201:` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>outer_on_greater( '20261001' ) exp = lt_exp ).
  ENDMETHOD.

  METHOD outer_where_right.
    DATA lt_exp TYPE string_table.
    APPEND `P001:P00001:20260101:` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>outer_where_right( ) exp = lt_exp ).
  ENDMETHOD.

  METHOD two_queries.
    DATA lt_exp TYPE string_table.
    APPEND `P001:1` TO lt_exp.
    APPEND `P002:0` TO lt_exp.
    APPEND `P003:1` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>two_queries( '20261001' ) exp = lt_exp ).
  ENDMETHOD.

  METHOD collect_sorted.
    DATA lt_exp TYPE string_table.
    APPEND `P000:1` TO lt_exp.
    APPEND `P001:2` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>collect_sorted( ) exp = lt_exp ).
  ENDMETHOD.

  METHOD collect_standard.
    DATA lt_exp TYPE string_table.
    APPEND `P001:2` TO lt_exp.
    APPEND `P000:1` TO lt_exp.
    cl_abap_unit_assert=>assert_equals( act = zcl_l2_outer_probe=>collect_standard( ) exp = lt_exp ).
  ENDMETHOD.
ENDCLASS.
