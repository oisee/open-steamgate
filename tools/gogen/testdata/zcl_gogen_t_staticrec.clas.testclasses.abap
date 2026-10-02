CLASS ltc DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS run FOR TESTING.
ENDCLASS.
CLASS ltc IMPLEMENTATION.
  METHOD run.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticrec=>run( ) exp = '2001' ).
  ENDMETHOD.
ENDCLASS.
