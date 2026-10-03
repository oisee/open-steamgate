CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
  METHOD check.
    zcl_kernel_compat=>forms( ).
    cl_abap_unit_assert=>assert_equals( act = zcl_kernel_compat=>mem exp = '0300' ).
  ENDMETHOD.
ENDCLASS.
