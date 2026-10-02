* Source: abapiti, 0facf0e, green on A4H.
* Items 1 and 2: REPLACE SECTION / FIND ... IN BYTE MODE on an xstring.
* ABAP 7.02, ASCII. Expected values follow the kernel documentation;
* not yet measured on A4H.
CLASS ltcl_bytes DEFINITION FINAL FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS r1_replace_middle FOR TESTING.
    METHODS r2_replace_at_start FOR TESTING.
    METHODS r3_replace_at_end FOR TESTING.
    METHODS r4_replace_with_zero_bytes FOR TESTING.
    METHODS r5_replace_one_byte_var_off FOR TESTING.
    METHODS r6_replace_out_of_range FOR TESTING.
    METHODS f1_no_half_byte_match FOR TESTING.
    METHODS f2_section_match_offset FOR TESTING.
    METHODS f3_outside_section FOR TESTING.
    METHODS f4_length_not_searched FOR TESTING.
    METHODS f5_find_zero_byte FOR TESTING.
ENDCLASS.

CLASS ltcl_bytes IMPLEMENTATION.

  METHOD r1_replace_middle.
    DATA lv_mem TYPE xstring.
    DATA lv_new TYPE xstring.
    lv_mem = '0011223344556677'.
    lv_new = 'AABB'.
    REPLACE SECTION OFFSET 2 LENGTH 2 OF lv_mem WITH lv_new IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '0011AABB44556677' ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( lv_mem ) exp = 8 ).
  ENDMETHOD.

  METHOD r2_replace_at_start.
    DATA lv_mem TYPE xstring.
    DATA lv_new TYPE x LENGTH 4.
    lv_mem = '0000000000000000'.
    lv_new = '04030201'.
    REPLACE SECTION OFFSET 0 LENGTH 4 OF lv_mem WITH lv_new IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '0403020100000000' ).
  ENDMETHOD.

  METHOD r3_replace_at_end.
    DATA lv_mem TYPE xstring.
    DATA lv_new TYPE x LENGTH 4.
    lv_mem = '0000000000000000'.
    lv_new = 'DEADBEEF'.
    REPLACE SECTION OFFSET 4 LENGTH 4 OF lv_mem WITH lv_new IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '00000000DEADBEEF' ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( lv_mem ) exp = 8 ).
  ENDMETHOD.

  METHOD r4_replace_with_zero_bytes.
* A JS hex/string runtime may drop or mis-pad 00 bytes.
    DATA lv_mem TYPE xstring.
    DATA lv_new TYPE x LENGTH 4.
    lv_mem = 'FFFFFFFFFFFFFFFF'.
    lv_new = '00000000'.
    REPLACE SECTION OFFSET 3 LENGTH 4 OF lv_mem WITH lv_new IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = 'FFFFFF00000000FF' ).
  ENDMETHOD.

  METHOD r5_replace_one_byte_var_off.
* Offset in a variable, as in the generated mem_st_i32_8 helper.
    DATA lv_mem TYPE xstring.
    DATA lv_b TYPE x LENGTH 1.
    DATA lv_addr TYPE i.
    lv_mem = '00000000'.
    lv_b = '7F'.
    lv_addr = 1.
    REPLACE SECTION OFFSET lv_addr LENGTH 1 OF lv_mem WITH lv_b IN BYTE MODE.
    lv_addr = 3.
    REPLACE SECTION OFFSET lv_addr LENGTH 1 OF lv_mem WITH lv_b IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '007F007F' ).
  ENDMETHOD.

  METHOD r6_replace_out_of_range.
* UNMEASURED: Section past the end: kernel raises CX_SY_RANGE_OUT_OF_BOUNDS
* and leaves lv_mem unchanged (WASM traps on an out-of-bounds store).
    DATA lv_mem TYPE xstring.
    DATA lv_new TYPE x LENGTH 4.
    DATA lv_raised TYPE abap_bool.
    lv_mem = '00000000'.
    lv_new = '11223344'.
    TRY.
        REPLACE SECTION OFFSET 2 LENGTH 4 OF lv_mem WITH lv_new IN BYTE MODE.
      CATCH cx_sy_range_out_of_bounds.
        lv_raised = abap_true.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = lv_raised exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = lv_mem exp = '00000000' ).
  ENDMETHOD.

  METHOD f1_no_half_byte_match.
* Hex text "012345" contains "12", the bytes 01 23 45 do not.
    DATA lv_mem TYPE xstring.
    DATA lv_pat TYPE xstring.
    lv_mem = '012345'.
    lv_pat = '12'.
    FIND lv_pat IN lv_mem IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
  ENDMETHOD.

  METHOD f2_section_match_offset.
* MATCH OFFSET is relative to the whole data object, not the section.
    DATA lv_mem TYPE xstring.
    DATA lv_pat TYPE xstring.
    DATA lv_off TYPE i.
    lv_mem = 'AABBCCAABBCC'.
    lv_pat = 'AABB'.
    FIND lv_pat IN SECTION OFFSET 1 LENGTH 5 OF lv_mem IN BYTE MODE
      MATCH OFFSET lv_off.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = lv_off exp = 3 ).
  ENDMETHOD.

  METHOD f3_outside_section.
    DATA lv_mem TYPE xstring.
    DATA lv_pat TYPE xstring.
    lv_mem = 'AABBCC'.
    lv_pat = 'CC'.
    FIND lv_pat IN SECTION OFFSET 0 LENGTH 2 OF lv_mem IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
  ENDMETHOD.

  METHOD f4_length_not_searched.
* ANOMALY-2026-10-01-find-byte-mode: the LENGTH operand must not become
* the search object. 05 lies outside the section.
    DATA lv_mem TYPE xstring.
    DATA lv_pat TYPE xstring.
    DATA lv_off TYPE i.
    lv_mem = '0102030405'.
    lv_pat = '05'.
    FIND lv_pat IN SECTION OFFSET 0 LENGTH 3 OF lv_mem IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
    lv_pat = '03'.
    FIND lv_pat IN SECTION OFFSET 0 LENGTH 3 OF lv_mem IN BYTE MODE
      MATCH OFFSET lv_off.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = lv_off exp = 2 ).
  ENDMETHOD.

  METHOD f5_find_zero_byte.
    DATA lv_mem TYPE xstring.
    DATA lv_pat TYPE xstring.
    DATA lv_off TYPE i.
    lv_mem = '11002200'.
    lv_pat = '00'.
    FIND lv_pat IN lv_mem IN BYTE MODE MATCH OFFSET lv_off.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = lv_off exp = 1 ).
  ENDMETHOD.

ENDCLASS.
