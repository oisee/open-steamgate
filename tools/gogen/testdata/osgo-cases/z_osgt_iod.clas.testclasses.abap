CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
cl_abap_unit_assert=>assert_equals( act = z_osgt_iod=>run( ) exp = abap_false ).
ENDMETHOD.
ENDCLASS.
