CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_bytemode=>byte_in_literal( ) exp = `a IN BYTE MODE b!` ).
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_bytemode=>char_in_literal( ) exp = `a IN CHARACTER MODE b!` ).
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_bytemode=>real_byte( ) exp = 'AB21' ).
ENDMETHOD.
ENDCLASS.
