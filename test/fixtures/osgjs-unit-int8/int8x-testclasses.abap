CLASS ltcl_int8x DEFINITION FINAL FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS to_x8_negative FOR TESTING.
    METHODS to_x8_pattern FOR TESTING.
    METHODS x8_back FOR TESTING.
    METHODS to_x4_truncates FOR TESTING.
    METHODS to_x16_pads FOR TESTING.
    METHODS to_x16_pads_negative FOR TESTING.
ENDCLASS.

CLASS ltcl_int8x IMPLEMENTATION.

  METHOD to_x8_negative.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 8.
    lv_i = -2.
    lv_x = lv_i.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = 'FFFFFFFFFFFFFFFE' ).
  ENDMETHOD.

  METHOD to_x8_pattern.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 8.
    lv_i = 72623859790382856.
    lv_x = lv_i.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = '0102030405060708' ).
  ENDMETHOD.

  METHOD x8_back.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 8.
    lv_x = 'FFFFFFFFFFFFFFFE'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = -2 ).
    lv_x = '0102030405060708'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = 72623859790382856 ).
  ENDMETHOD.

  METHOD to_x4_truncates.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 4.
    lv_i = 72623859790382856.
    lv_x = lv_i.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = '05060708' ).
  ENDMETHOD.

  METHOD to_x16_pads.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 16.
    lv_i = 72623859790382856.
    lv_x = lv_i.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = '00000000000000000102030405060708' ).
  ENDMETHOD.

  METHOD to_x16_pads_negative.
    DATA lv_i TYPE int8.
    DATA lv_x TYPE x LENGTH 16.
    lv_i = -2.
    lv_x = lv_i.
    cl_abap_unit_assert=>assert_equals( act = lv_x exp = '0000000000000000FFFFFFFFFFFFFFFE' ).
  ENDMETHOD.

ENDCLASS.
