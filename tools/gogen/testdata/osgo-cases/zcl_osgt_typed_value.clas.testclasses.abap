CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA date TYPE d.
DATA time TYPE t.
DATA numeric TYPE zcl_osgt_typed_value=>numeric.
DATA text TYPE zcl_osgt_typed_value=>text.
DATA amount TYPE zcl_osgt_typed_value=>amount.
cl_abap_unit_assert=>assert_equals( act = VALUE d( ) exp = '00000000' ).
cl_abap_unit_assert=>assert_equals( act = VALUE t( ) exp = '000000' ).
cl_abap_unit_assert=>assert_equals( act = VALUE zcl_osgt_typed_value=>numeric( ) exp = '00000' ).
cl_abap_unit_assert=>assert_equals( act = VALUE zcl_osgt_typed_value=>text( ) exp = '   ' ).
cl_abap_unit_assert=>assert_equals( act = VALUE zcl_osgt_typed_value=>amount( ) exp = '0.00' ).
cl_abap_unit_assert=>assert_initial( date ).
cl_abap_unit_assert=>assert_initial( time ).
cl_abap_unit_assert=>assert_initial( numeric ).
cl_abap_unit_assert=>assert_initial( text ).
cl_abap_unit_assert=>assert_initial( amount ).
ENDMETHOD.
ENDCLASS.
