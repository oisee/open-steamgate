CLASS ltcl_double DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS two_is_four FOR TESTING.
    METHODS zero_is_zero FOR TESTING.
    METHODS helper RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS ltcl_double IMPLEMENTATION.
  METHOD two_is_four.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_prove_demo=>double( 2 ) exp = 4 ).
  ENDMETHOD.
  METHOD zero_is_zero.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_prove_demo=>double( helper( ) ) exp = 0 ).
  ENDMETHOD.
  METHOD helper.
    rv = 0.
  ENDMETHOD.
ENDCLASS.
