* Two test classes with the same two methods. Each first method must see the
* class constructed once and the counter at 1, and each second method the
* counter at 2: statics start over per test class and are shared inside one.
CLASS ltc_a DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS m1_first FOR TESTING.
    METHODS m2_second FOR TESTING.
ENDCLASS.

CLASS ltc_a IMPLEMENTATION.
  METHOD m1_first.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>constructed( ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>bump( ) exp = 1 ).
  ENDMETHOD.

  METHOD m2_second.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>bump( ) exp = 2 ).
  ENDMETHOD.
ENDCLASS.

CLASS ltc_b DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS m1_first FOR TESTING.
    METHODS m2_second FOR TESTING.
ENDCLASS.

CLASS ltc_b IMPLEMENTATION.
  METHOD m1_first.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>constructed( ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>bump( ) exp = 1 ).
  ENDMETHOD.

  METHOD m2_second.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_statics_test=>bump( ) exp = 2 ).
  ENDMETHOD.
ENDCLASS.
