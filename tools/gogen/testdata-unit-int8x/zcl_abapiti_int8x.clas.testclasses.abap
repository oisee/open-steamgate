* First six methods: measured A4H 758 oracle supplied with TASK.md.
* Additional methods: supplied oracle and documentation; see NOTES.md.
CLASS ltcl_int8x DEFINITION FINAL FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS documented_xstrings FOR TESTING.
    METHODS documented_comparisons FOR TESTING.
    METHODS boundaries FOR TESTING.
    METHODS widths FOR TESTING.
    METHODS i_bytes FOR TESTING.
    METHODS xstrings FOR TESTING.
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

  METHOD boundaries.
    DATA v TYPE int8.
    DATA back TYPE int8.
    DATA raw TYPE x LENGTH 8.
    v = -1.
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = 'FFFFFFFFFFFFFFFF' ).
    back = raw.
    cl_abap_unit_assert=>assert_equals( act = back exp = v ).
    v = 0.
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = '0000000000000000' ).
    back = raw.
    cl_abap_unit_assert=>assert_equals( act = back exp = v ).
    v = 9223372036854775807.
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = '7FFFFFFFFFFFFFFF' ).
    back = raw.
    cl_abap_unit_assert=>assert_equals( act = back exp = v ).
    v = -9223372036854775808.
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = '8000000000000000' ).
    back = raw.
    cl_abap_unit_assert=>assert_equals( act = back exp = v ).
  ENDMETHOD.

  METHOD widths.
    DATA v TYPE int8.
    DATA small TYPE x LENGTH 2.
    DATA large TYPE x LENGTH 32.
    v = 72623859790382856.
    small = v.
    cl_abap_unit_assert=>assert_equals( act = small exp = '0708' ).
    small = 'FFFF'.
    v = small.
    cl_abap_unit_assert=>assert_equals( act = v exp = 65535 ).
    large = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE'.
    v = large.
    cl_abap_unit_assert=>assert_equals( act = v exp = -2 ).
  ENDMETHOD.

  METHOD i_bytes.
    DATA v TYPE i.
    DATA small TYPE x LENGTH 2.
    DATA large TYPE x LENGTH 8.
    v = -2.
    large = v.
    cl_abap_unit_assert=>assert_equals( act = large exp = '00000000FFFFFFFE' ).
    v = large.
    cl_abap_unit_assert=>assert_equals( act = v exp = -2 ).
    small = 'FFFF'.
    v = small.
    cl_abap_unit_assert=>assert_equals( act = v exp = 65535 ).
    v = -1.
    small = v.
    cl_abap_unit_assert=>assert_equals( act = small exp = 'FFFF' ).
  ENDMETHOD.

  METHOD xstrings.
    DATA v TYPE int8.
    DATA raw TYPE xstring.
    raw = 'FFFFFFFFFFFFFFFE'.
    v = raw.
    cl_abap_unit_assert=>assert_equals( act = v exp = -2 ).
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = 'FFFFFFFFFFFFFFFE' ).
    raw = 'FF'.
    v = raw.
    cl_abap_unit_assert=>assert_equals( act = v exp = 255 ).
    raw = v.
    cl_abap_unit_assert=>assert_equals( act = raw exp = 'FF' ).
    raw = '018000000000000000'.
    v = raw.
    cl_abap_unit_assert=>assert_equals( act = v exp = -9223372036854775808 ).
    CLEAR raw.
    v = raw.
    cl_abap_unit_assert=>assert_equals( act = v exp = 0 ).
  ENDMETHOD.

  METHOD documented_xstrings.
    DATA v TYPE int8.
    DATA num TYPE i.
    DATA b TYPE int1.
    DATA s TYPE int2.
    DATA raw TYPE xstring.

* Supplied oracle and documentation, unmeasured extensions: see NOTES.md.
    num = 0.
    raw = num.
    ASSERT raw = '00'.
    v = 0.
    raw = v.
    ASSERT raw = '00'.
    v = 4294967296.
    raw = v.
    ASSERT raw = '0100000000'.
    v = 1099511627776.
    raw = v.
    ASSERT raw = '010000000000'.
    v = 281474976710656.
    raw = v.
    ASSERT raw = '01000000000000'.
    v = -1.
    raw = v.
    ASSERT raw = 'FFFFFFFFFFFFFFFF'.
    num = -1.
    raw = num.
    ASSERT raw = 'FFFFFFFF'.
    b = 0.
    raw = b.
    ASSERT raw = '00'.
    b = 255.
    raw = b.
    ASSERT raw = 'FF'.
    s = 0.
    raw = s.
    ASSERT raw = '00'.
    s = 32767.
    raw = s.
    ASSERT raw = '7FFF'.
    s = -32768.
    raw = s.
    ASSERT raw = 'FFFF8000'.
  ENDMETHOD.

  METHOD documented_comparisons.
    DATA v TYPE int8.
    DATA num TYPE i.
    DATA raw TYPE xstring.
    DATA x1 TYPE x LENGTH 1.
    DATA x4 TYPE x LENGTH 4.
    DATA x9 TYPE x LENGTH 9.
    x1 = 'FF'.
    v = 255.
    ASSERT x1 = v.
    ASSERT v = x1.
    v = -1.
    ASSERT x1 > v.
    ASSERT v < x1.
    v = 511.
    ASSERT x1 <> v.
    ASSERT v <> x1.
    x4 = 'FFFFFFFF'.
    num = -1.
    ASSERT x4 = num.
    ASSERT num = x4.
    v = 4294967295.
    ASSERT x4 = v.
    ASSERT v = x4.
    v = -1.
    ASSERT x4 > v.
    x9 = '010000000000000000'.
    v = 0.
    ASSERT x9 = v.
    ASSERT v = x9.
    raw = 'FFFFFFFFFFFFFFFF'.
    v = -1.
    ASSERT raw = v.
    CLEAR raw.
    v = 0.
    ASSERT raw = v.
  ENDMETHOD.

ENDCLASS.
