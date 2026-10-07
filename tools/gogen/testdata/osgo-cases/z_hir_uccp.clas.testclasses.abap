CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
cl_abap_unit_assert=>assert_equals( act = cl_abap_conv_out_ce=>uccp( '€' ) exp = '20AC' ).
ENDMETHOD.
ENDCLASS.
