* ABAPiti oracle 009: A4H measurement, 2026-10-02 (eight cases).
CLASS ltc DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS x2_off1_len1_ffff FOR TESTING.
    METHODS x2_off0_len2_ab FOR TESTING.
    METHODS x4_off1_len2_a1a2a3 FOR TESTING.
    METHODS x4_off1_len2_ab FOR TESTING.
    METHODS xs_off1_len1_ffff FOR TESTING.
    METHODS x2_off1_len1_ab FOR TESTING.
    METHODS x2_off2_len0_ab FOR TESTING.
    METHODS x2_off0_len1_a1a2a3 FOR TESTING.
ENDCLASS.
CLASS ltc IMPLEMENTATION.
  METHOD x2_off1_len1_ffff.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 1 ) exp = `[12FF rc=2]` ).
  ENDMETHOD.
  METHOD x2_off0_len2_ab.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 2 ) exp = `[AB00 rc=0]` ).
  ENDMETHOD.
  METHOD x4_off1_len2_a1a2a3.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 3 ) exp = `[11A1A2A3 rc=2]` ).
  ENDMETHOD.
  METHOD x4_off1_len2_ab.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 4 ) exp = `[11AB4400 rc=0]` ).
  ENDMETHOD.
  METHOD xs_off1_len1_ffff.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 5 ) exp = `[12FFFF rc=0]` ).
  ENDMETHOD.
  METHOD x2_off1_len1_ab.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 6 ) exp = `[12AB rc=0]` ).
  ENDMETHOD.
  METHOD x2_off2_len0_ab.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 7 ) exp = `[1234 rc=2]` ).
  ENDMETHOD.
  METHOD x2_off0_len1_a1a2a3.
    cl_abap_unit_assert=>assert_equals( act = zcl_gogen_t_repl009=>probe( 8 ) exp = `[A1A2 rc=2]` ).
  ENDMETHOD.
ENDCLASS.
