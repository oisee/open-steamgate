CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
 PRIVATE SECTION.
 METHODS serving_database FOR TESTING.
 METHODS generation FOR TESTING.
ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION.
 METHOD serving_database.
 cl_abap_unit_assert=>assert_equals( act = zcl_osd_kernel_guard=>has_serving_database( ) exp = abap_false ).
 ENDMETHOD.
 METHOD generation.
 cl_abap_unit_assert=>assert_equals( act = zcl_osd_kernel_guard=>has_generation( ) exp = abap_false ).
 ENDMETHOD.
ENDCLASS.
