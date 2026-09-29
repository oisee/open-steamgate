CLASS ltcl_ranges DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    TYPES ty_dates TYPE RANGE OF d.
    METHODS typed_rows_become_strings FOR TESTING.
    METHODS empty_range_stays_empty FOR TESTING.
ENDCLASS.


CLASS ltcl_ranges IMPLEMENTATION.

  METHOD typed_rows_become_strings.
    DATA lt_dates TYPE ty_dates.
    DATA ls_date LIKE LINE OF lt_dates.
    DATA lt_ranges TYPE zif_gg_selection_screen_types=>ty_ranges.
    DATA ls_range LIKE LINE OF lt_ranges.

    ls_date-sign = 'I'.
    ls_date-option = 'BT'.
    ls_date-low = '20260101'.
    ls_date-high = '20261231'.
    APPEND ls_date TO lt_dates.
    ls_date-sign = 'E'.
    ls_date-option = 'EQ'.
    ls_date-low = '20260704'.
    CLEAR ls_date-high.
    APPEND ls_date TO lt_dates.

    lt_ranges = zcl_osd_submit_ranges=>of( lt_dates ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_ranges ) exp = 2 ).
    READ TABLE lt_ranges INTO ls_range INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = ls_range-sign exp = 'I' ).
    cl_abap_unit_assert=>assert_equals( act = ls_range-option exp = 'BT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_range-low exp = '20260101' ).
    cl_abap_unit_assert=>assert_equals( act = ls_range-high exp = '20261231' ).
    READ TABLE lt_ranges INTO ls_range INDEX 2.
    cl_abap_unit_assert=>assert_equals( act = ls_range-sign exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_range-low exp = '20260704' ).
  ENDMETHOD.

  METHOD empty_range_stays_empty.
    DATA lt_dates TYPE ty_dates.
    cl_abap_unit_assert=>assert_initial( zcl_osd_submit_ranges=>of( lt_dates ) ).
  ENDMETHOD.

ENDCLASS.
