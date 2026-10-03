CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
  METHOD check.
    DATA result TYPE xstring.
    result = zcl_kernel_valid=>forms( ).
    cl_abap_unit_assert=>assert_equals( act = result exp = '0500' ).
  ENDMETHOD.
ENDCLASS.
