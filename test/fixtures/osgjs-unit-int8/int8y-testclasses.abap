CLASS ltcl_int8y DEFINITION FINAL FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS x2_fffe FOR TESTING.
    METHODS x4_ffffffff FOR TESTING.
    METHODS x16_low_minus2 FOR TESTING.
    METHODS x16_high_bytes_set FOR TESTING.
ENDCLASS.

CLASS ltcl_int8y IMPLEMENTATION.

  METHOD x2_fffe.
    DATA lv_x TYPE x LENGTH 2.
    DATA lv_i TYPE int8.
    lv_x = 'FFFE'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = 65534 ).
  ENDMETHOD.

  METHOD x4_ffffffff.
    DATA lv_x TYPE x LENGTH 4.
    DATA lv_i TYPE int8.
    lv_x = 'FFFFFFFF'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = 4294967295 ).
  ENDMETHOD.

  METHOD x16_low_minus2.
    DATA lv_x TYPE x LENGTH 16.
    DATA lv_i TYPE int8.
    lv_x = '0000000000000000FFFFFFFFFFFFFFFE'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = -2 ).
  ENDMETHOD.

  METHOD x16_high_bytes_set.
    DATA lv_x TYPE x LENGTH 16.
    DATA lv_i TYPE int8.
    lv_x = 'FF000000000000000000000000000001'.
    lv_i = lv_x.
    cl_abap_unit_assert=>assert_equals( act = lv_i exp = 1 ).
  ENDMETHOD.

ENDCLASS.
