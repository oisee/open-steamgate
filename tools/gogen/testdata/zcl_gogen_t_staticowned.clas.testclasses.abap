CLASS ltcl_staticowned DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS snapshots FOR TESTING.
ENDCLASS.
CLASS ltcl_staticowned IMPLEMENTATION.
  METHOD snapshots.
    DATA result TYPE string.
    result = zcl_gogen_t_staticowned=>run( ).
    cl_abap_unit_assert=>assert_equals( act = result exp = '0102030401ABCD0401ABCD04ABCD' ).
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_staticreset DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS initial_again FOR TESTING.
ENDCLASS.
CLASS ltcl_staticreset IMPLEMENTATION.
  METHOD initial_again.
    DATA result TYPE string.
    result = zcl_gogen_t_staticowned=>run( ).
    cl_abap_unit_assert=>assert_equals( act = result exp = '0102030401ABCD0401ABCD04ABCD' ).
  ENDMETHOD.
ENDCLASS.
