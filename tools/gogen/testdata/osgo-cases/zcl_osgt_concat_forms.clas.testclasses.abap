CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_concat_forms=>byte_words_in_literal( ) exp = `AIN BYTE MODE RESPECTING BLANKS` ).
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_concat_forms=>char_words_in_literal( ) exp = `AIN CHARACTER MODE` ).
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_concat_forms=>separator_words_in_literal( ) exp = `A SEPARATED BY` ).
cl_abap_unit_assert=>assert_equals( act = zcl_osgt_concat_forms=>real_respecting( ) exp = `A  B` ).
ENDMETHOD.
ENDCLASS.
