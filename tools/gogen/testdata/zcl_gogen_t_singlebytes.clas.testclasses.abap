CLASS ltcl_bytes DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS bytes FOR TESTING.
ENDCLASS.
CLASS ltcl_bytes IMPLEMENTATION.
  METHOD bytes.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_gogen_t_singlebytes=>empty_source( ) exp = '00/0' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_gogen_t_singlebytes=>run( )
      exp = '255/-2147483648/254/255/FE7FFF80' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_gogen_t_singlebytes=>replace_fit( ) exp = '12FF/2/12FFFF/0' ).
  ENDMETHOD.
ENDCLASS.
