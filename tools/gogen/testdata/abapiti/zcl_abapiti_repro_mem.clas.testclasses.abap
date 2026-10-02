* Source: abapiti, 0facf0e, green on A4H.
* WASM linear memory is little-endian. Expected bytes and values follow the
* WASM spec (i32.store/load, store8/16 wrap, load8_s/u, load16_u).
CLASS ltcl_mem DEFINITION FINAL FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS i32_roundtrip FOR TESTING.
    METHODS i32_negative FOR TESTING.
    METHODS store8_wraps_load8_sign FOR TESTING.
    METHODS store16_wraps_load16u FOR TESTING.
ENDCLASS.

CLASS ltcl_mem IMPLEMENTATION.

  METHOD i32_roundtrip.
    DATA lv_mem TYPE xstring.
    lv_mem = '0000000000000000'.
    zcl_abapiti_repro_mem=>st_i32( EXPORTING iv_addr = 2 iv_val = 16909060
                                   CHANGING cv_mem = lv_mem ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '0000040302010000' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_abapiti_repro_mem=>ld_i32( iv_mem = lv_mem iv_addr = 2 )
      exp = 16909060 ).
  ENDMETHOD.

  METHOD i32_negative.
    DATA lv_mem TYPE xstring.
    lv_mem = '0000000000000000'.
    zcl_abapiti_repro_mem=>st_i32( EXPORTING iv_addr = 4 iv_val = -2
                                   CHANGING cv_mem = lv_mem ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '00000000FEFFFFFF' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_abapiti_repro_mem=>ld_i32( iv_mem = lv_mem iv_addr = 4 )
      exp = -2 ).
  ENDMETHOD.

  METHOD store8_wraps_load8_sign.
    DATA lv_mem TYPE xstring.
    lv_mem = '00000000'.
    zcl_abapiti_repro_mem=>st_8( EXPORTING iv_addr = 3 iv_val = 511
                                 CHANGING cv_mem = lv_mem ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '000000FF' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_abapiti_repro_mem=>ld_8u( iv_mem = lv_mem iv_addr = 3 )
      exp = 255 ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_abapiti_repro_mem=>ld_8s( iv_mem = lv_mem iv_addr = 3 )
      exp = -1 ).
  ENDMETHOD.

  METHOD store16_wraps_load16u.
    DATA lv_mem TYPE xstring.
    lv_mem = '00000000'.
    zcl_abapiti_repro_mem=>st_16( EXPORTING iv_addr = 1 iv_val = 74565
                                  CHANGING cv_mem = lv_mem ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '00452300' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_abapiti_repro_mem=>ld_16u( iv_mem = lv_mem iv_addr = 1 )
      exp = 9029 ).
  ENDMETHOD.

ENDCLASS.
