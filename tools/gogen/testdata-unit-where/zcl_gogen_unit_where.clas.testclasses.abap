* where of a failed row (#695 critic): an error in CLASS_SETUP is the
* site of every row, one in CLASS_TEARDOWN joins each row's own
CLASS ltcl_setup DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-METHODS class_setup.
    METHODS first FOR TESTING.
ENDCLASS.
CLASS ltcl_setup IMPLEMENTATION.
  METHOD class_setup.
    zcl_gogen_unit_where=>divide( 0 ).
  ENDMETHOD.
  METHOD first.
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_teardown DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-METHODS class_teardown.
    METHODS passes FOR TESTING.
    METHODS fails FOR TESTING.
ENDCLASS.
CLASS ltcl_teardown IMPLEMENTATION.
  METHOD class_teardown.
    zcl_gogen_unit_where=>divide( 0 ).
  ENDMETHOD.
  METHOD passes.
  ENDMETHOD.
  METHOD fails.
    DATA lv_zero TYPE i.
    lv_zero = 1 / lv_zero.
  ENDMETHOD.
ENDCLASS.
