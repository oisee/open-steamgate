* The minimal standard's own check, on whatever runs this class.
CLASS ltcl_random DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS park_miller FOR TESTING RAISING cx_static_check.
    METHODS same_seed_same_draws FOR TESTING RAISING cx_static_check.
    METHODS empty_ranges FOR TESTING RAISING cx_static_check.
ENDCLASS.


CLASS ltcl_random IMPLEMENTATION.

  METHOD park_miller.
    DATA lv_x TYPE i.
    DATA lv_n TYPE i.
* the minimal standard's own check: from 1, step 10000 is 1043618065
* (Park and Miller, CACM 31(10), 1988)
    lv_x = 1.
    DO 10000 TIMES.
      lv_x = zcl_osd_demo_random=>step( lv_x ).
    ENDDO.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = 1043618065 ).
* the largest state stays in range: no intermediate overflow
    lv_x = zcl_osd_demo_random=>step( 2147483646 ).
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = 2147466840 ).
    lv_n = 0.
    IF lv_x > 0.
      lv_n = 1.
    ENDIF.
    cl_abap_unit_assert=>assert_equals( act = lv_n exp = 1 ).
  ENDMETHOD.

  METHOD same_seed_same_draws.
    DATA lo_a TYPE REF TO zcl_osd_demo_random.
    DATA lo_b TYPE REF TO zcl_osd_demo_random.
    DATA lv_a TYPE i.
    DATA lv_b TYPE i.
    CREATE OBJECT lo_a EXPORTING iv_seed = 42.
    CREATE OBJECT lo_b EXPORTING iv_seed = 42.
    DO 100 TIMES.
      lv_a = lo_a->draw( 1000 ).
      lv_b = lo_b->draw( 1000 ).
      cl_abap_unit_assert=>assert_equals( act = lv_b exp = lv_a ).
      cl_abap_unit_assert=>assert_true( boolc( lv_a >= 0 AND lv_a < 1000 ) ).
    ENDDO.
  ENDMETHOD.

  METHOD empty_ranges.
    DATA lo_a TYPE REF TO zcl_osd_demo_random.
    DATA lt_none TYPE zcl_osd_demo_random=>ty_ints.
    DATA lv_k TYPE i.
    CREATE OBJECT lo_a EXPORTING iv_seed = 0.
    lv_k = lo_a->draw( 0 ).
    cl_abap_unit_assert=>assert_equals( act = lv_k exp = 0 ).
    lv_k = lo_a->draw( -3 ).
    cl_abap_unit_assert=>assert_equals( act = lv_k exp = 0 ).
    lv_k = lo_a->pick( lt_none ).
    cl_abap_unit_assert=>assert_equals( act = lv_k exp = 0 ).
  ENDMETHOD.

ENDCLASS.
