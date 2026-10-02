CLASS ltc DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS assign FOR TESTING.
    METHODS int8 FOR TESTING.
    METHODS replace FOR TESTING.
    METHODS concat FOR TESTING.
    METHODS offset FOR TESTING.
    METHODS clear FOR TESTING.
ENDCLASS.
CLASS ltc IMPLEMENTATION.
  METHOD assign.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>w_assign( ) exp = 6 ).
  ENDMETHOD.
  METHOD int8.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>w_int8( ) exp = 9000000000 ).
  ENDMETHOD.
  METHOD replace.
    DATA lv TYPE xstring.
    lv = '00ABCD00'.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>w_replace( ) exp = lv ).
  ENDMETHOD.
  METHOD concat.
    DATA lv TYPE xstring.
    lv = '11EE'.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>w_concat( ) exp = lv ).
  ENDMETHOD.
  METHOD offset.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>r_offset( ) exp = 127 ).
  ENDMETHOD.
  METHOD clear.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_staticoracle=>w_clear( ) exp = 0 ).
  ENDMETHOD.
ENDCLASS.
