CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA short TYPE x LENGTH 1.
DATA padded TYPE x LENGTH 3.
zcl_osgt_xseq_fit=>fill( IMPORTING buffer = short ).
zcl_osgt_xseq_fit=>fill_short( IMPORTING buffer = padded ).
cl_abap_unit_assert=>assert_equals( act = short exp = 'AA' ).
cl_abap_unit_assert=>assert_equals( act = padded exp = 'AA0000' ).
ENDMETHOD.
ENDCLASS.
