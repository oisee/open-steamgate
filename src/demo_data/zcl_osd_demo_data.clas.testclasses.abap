* ENSURE_TAXI and BOOT on ZOSD_TAXIFACT: idempotence, the knob, and the
* rows that are not ours.
CLASS ltcl_demo_data DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS teardown.
    METHODS ensure_is_idempotent FOR TESTING RAISING cx_static_check.
    METHODS real_rows_untouched FOR TESTING RAISING cx_static_check.
    METHODS boot_knob FOR TESTING RAISING cx_static_check.

    METHODS real_rows
      RETURNING
        VALUE(rv_rows) TYPE i.
    METHODS synthetic_rows
      RETURNING
        VALUE(rv_rows) TYPE i.
ENDCLASS.


CLASS ltcl_demo_data IMPLEMENTATION.

  METHOD teardown.
    zcl_osd_demo_data=>ensure_taxi( iv_rows = 0 ).
  ENDMETHOD.

  METHOD real_rows.
    SELECT COUNT(*) FROM zosd_taxifact INTO rv_rows WHERE fact_id < zcl_osd_demo_taxi=>c_synthetic_min.
  ENDMETHOD.

  METHOD synthetic_rows.
    SELECT COUNT(*) FROM zosd_taxifact INTO rv_rows WHERE fact_id >= zcl_osd_demo_taxi=>c_synthetic_min.
  ENDMETHOD.

  METHOD ensure_is_idempotent.
    DATA lv_report TYPE string.
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 500 iv_seed = 3 ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*written*' ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 500 ).
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 500 iv_seed = 3 ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*unchanged*' ).
* another seed at the same size is another table
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 500 iv_seed = 4 ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*written*500 replaced*' ).
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 120 iv_seed = 4 ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 120 ).
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 0 ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 0 ).
  ENDMETHOD.

  METHOD real_rows_untouched.
    DATA ls_fact TYPE zosd_taxifact.
    DATA lv_before TYPE i.
    DATA lv_report TYPE string.
    lv_before = real_rows( ).
    zcl_osd_demo_data=>ensure_taxi( iv_rows = 300 iv_seed = 5 ).
    zcl_osd_demo_data=>ensure_taxi( iv_rows = 0 ).
    cl_abap_unit_assert=>assert_equals( act = real_rows( ) exp = lv_before ).
* enough real rows: nothing synthetic is added
    ls_fact-mandt = sy-mandt.
    ls_fact-fact_id = '8999999999'.
    ls_fact-pickup_day = '20250102'.
    ls_fact-borough = 'Queens'.
    ls_fact-zone = 'JFK Airport'.
    ls_fact-payment = 'Card'.
    ls_fact-trips = 1.
    INSERT zosd_taxifact FROM ls_fact.
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = 1 ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*real rows*' ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 0 ).
* an import after a start: synthetic rows of the last start beside real
* rows that are enough now; the real rows alone remain
    DELETE FROM zosd_taxifact WHERE fact_id = '8999999999'.
    lv_before = real_rows( ).
    zcl_osd_demo_data=>ensure_taxi( iv_rows = 50 iv_seed = 6 ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 50 ).
    INSERT zosd_taxifact FROM ls_fact.
    lv_report = zcl_osd_demo_data=>ensure_taxi( iv_rows = lv_before + 1 ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*50 removed*' ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = real_rows( ) exp = lv_before + 1 ).
    DELETE FROM zosd_taxifact WHERE fact_id = '8999999999'.
  ENDMETHOD.

  METHOD boot_knob.
    DATA lv_report TYPE string.
    lv_report = zcl_osd_demo_data=>boot( `many` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_report exp = '*not a number*' ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 0 ).
    lv_report = zcl_osd_demo_data=>boot( ` 40 ` ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 40 ).
    lv_report = zcl_osd_demo_data=>boot( `0` ).
    cl_abap_unit_assert=>assert_equals( act = synthetic_rows( ) exp = 0 ).
  ENDMETHOD.

ENDCLASS.
