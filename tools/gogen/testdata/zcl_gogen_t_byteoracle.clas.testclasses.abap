* Source: test/fixtures/kernel-oracle/expect.json, P1/P2, A4H 2026-10-02.
CLASS ltcl_oracle DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS p1_01 FOR TESTING.
    METHODS p1_02 FOR TESTING.
    METHODS p1_03 FOR TESTING.
    METHODS p1_04 FOR TESTING.
    METHODS p1_05 FOR TESTING.
    METHODS p1_06 FOR TESTING.
    METHODS p1_07 FOR TESTING.
    METHODS p1_08 FOR TESTING.
    METHODS p1_09 FOR TESTING.
    METHODS p1_10 FOR TESTING.
    METHODS p1_11 FOR TESTING.
    METHODS p1_12 FOR TESTING.
    METHODS p2_01 FOR TESTING.
    METHODS p2_02 FOR TESTING.
    METHODS p2_03 FOR TESTING.
    METHODS p2_04 FOR TESTING.
    METHODS p2_05 FOR TESTING.
    METHODS p2_06 FOR TESTING.
    METHODS p2_07 FOR TESTING.
    METHODS p2_08 FOR TESTING.
    METHODS p2_09 FOR TESTING.
    METHODS p2_10 FOR TESTING.
    METHODS p2_11 FOR TESTING.
ENDCLASS.
CLASS ltcl_oracle IMPLEMENTATION.
  METHOD p1_01.
* A4H oracle P1: same o2l2 AABB
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'AABB'.
    TRY.
        REPLACE SECTION OFFSET 2 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '0011AABB445566 rc0' ).
  ENDMETHOD.
  METHOD p1_02.
* A4H oracle P1: shorter o2l3 AA
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'AA'.
    TRY.
        REPLACE SECTION OFFSET 2 LENGTH 3 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '0011AA5566 rc0' ).
  ENDMETHOD.
  METHOD p1_03.
* A4H oracle P1: longer o2l1 AABBCC
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'AABBCC'.
    TRY.
        REPLACE SECTION OFFSET 2 LENGTH 1 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '0011AABBCC33445566 rc0' ).
  ENDMETHOD.
  METHOD p1_04.
* A4H oracle P1: o0l2 FF
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'FF'.
    TRY.
        REPLACE SECTION OFFSET 0 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'FF2233445566 rc0' ).
  ENDMETHOD.
  METHOD p1_05.
* A4H oracle P1: o5l2 EE (end)
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'EE'.
    TRY.
        REPLACE SECTION OFFSET 5 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '0011223344EE rc0' ).
  ENDMETHOD.
  METHOD p1_06.
* A4H oracle P1: o7l0 EE (append)
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'EE'.
    TRY.
        REPLACE SECTION OFFSET 7 LENGTH 0 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '00112233445566EE rc0' ).
  ENDMETHOD.
  METHOD p1_07.
* A4H oracle P1: o6l2 beyond
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'EE'.
    TRY.
        REPLACE SECTION OFFSET 6 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'CX_SY_RANGE_OUT_OF_BOUNDS' ).
    cl_abap_unit_assert=>assert_equals( act = xs exp = '00112233445566' ).
  ENDMETHOD.
  METHOD p1_08.
* A4H oracle P1: o8l0 past end
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'EE'.
    TRY.
        REPLACE SECTION OFFSET 8 LENGTH 0 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'CX_SY_RANGE_OUT_OF_BOUNDS' ).
    cl_abap_unit_assert=>assert_equals( act = xs exp = '00112233445566' ).
  ENDMETHOD.
  METHOD p1_09.
* A4H oracle P1: o2l2 empty
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = ''.
    TRY.
        REPLACE SECTION OFFSET 2 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '0011445566 rc0' ).
  ENDMETHOD.
  METHOD p1_10.
* A4H oracle P1: o0l7 all
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233445566'.
    w = 'AB'.
    TRY.
        REPLACE SECTION OFFSET 0 LENGTH 7 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'AB rc0' ).
  ENDMETHOD.
  METHOD p1_11.
* A4H oracle P1: x4 longer
    DATA xs TYPE x LENGTH 4.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233'.
    w = 'AABB'.
    TRY.
        REPLACE SECTION OFFSET 1 LENGTH 1 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '00AABB22 rc2' ).
  ENDMETHOD.
  METHOD p1_12.
* A4H oracle P1: x4 shorter
    DATA xs TYPE x LENGTH 4.
    DATA w TYPE xstring.
    DATA actual TYPE string.
    xs = '00112233'.
    w = 'AA'.
    TRY.
        REPLACE SECTION OFFSET 1 LENGTH 2 OF xs WITH w IN BYTE MODE.
        actual = |{ xs } rc{ sy-subrc }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = '00AA3300 rc0' ).
  ENDMETHOD.
  METHOD p2_01.
* A4H oracle P2: nibble 3C
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = '3C'.
    TRY.
        FIND p IN xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc4 o0' ).
  ENDMETHOD.
  METHOD p2_02.
* A4H oracle P2: C3 in o1l1
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND p IN SECTION OFFSET 1 LENGTH 1 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc4 o0' ).
  ENDMETHOD.
  METHOD p2_03.
* A4H oracle P2: C3 in o1l2
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND p IN SECTION OFFSET 1 LENGTH 2 OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.
        actual = |rc{ sy-subrc } o{ m } l{ ml }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc0 o2 l1' ).
  ENDMETHOD.
  METHOD p2_04.
* A4H oracle P2: FIRST C3
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND FIRST OCCURRENCE OF p IN xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc0 o0' ).
  ENDMETHOD.
  METHOD p2_05.
* A4H oracle P2: ALL C3
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA cnt TYPE i.
    DATA res TYPE match_result_tab.
    DATA row TYPE match_result.
    DATA matches TYPE string.
    DATA rc TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND ALL OCCURRENCES OF p IN xs IN BYTE MODE MATCH COUNT cnt RESULTS res.
        rc = sy-subrc.
        LOOP AT res INTO row.
          matches = matches && |{ row-offset }/{ row-length } |.
        ENDLOOP.
        actual = |rc{ rc } n{ cnt } [{ matches }]|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc0 n2 [0/1 2/1 ]' ).
  ENDMETHOD.
  METHOD p2_06.
* A4H oracle P2: o2l5 past end
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND p IN SECTION OFFSET 2 LENGTH 5 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'CX_SY_RANGE_OUT_OF_BOUNDS' ).
  ENDMETHOD.
  METHOD p2_07.
* A4H oracle P2: o4 past end
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND p IN SECTION OFFSET 4 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'CX_SY_RANGE_OUT_OF_BOUNDS' ).
  ENDMETHOD.
  METHOD p2_08.
* A4H oracle P2: o3 at end
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'C3'.
    TRY.
        FIND p IN SECTION OFFSET 3 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc4 o0' ).
  ENDMETHOD.
  METHOD p2_09.
* A4H oracle P2: empty needle
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = ''.
    TRY.
        FIND p IN xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc0 o0' ).
  ENDMETHOD.
  METHOD p2_10.
* A4H oracle P2: A3C3 in o0l2
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'A3C3'.
    TRY.
        FIND p IN SECTION OFFSET 0 LENGTH 2 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc4 o0' ).
  ENDMETHOD.
  METHOD p2_11.
* A4H oracle P2: A3C3 in o0l3
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i.
    DATA ml TYPE i.
    DATA actual TYPE string.
    xs = 'C3A3C3'.
    p = 'A3C3'.
    TRY.
        FIND p IN SECTION OFFSET 0 LENGTH 3 OF xs IN BYTE MODE MATCH OFFSET m.
        actual = |rc{ sy-subrc } o{ m }|.
      CATCH cx_sy_range_out_of_bounds.
        actual = 'CX_SY_RANGE_OUT_OF_BOUNDS'.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = actual exp = 'rc0 o1' ).
  ENDMETHOD.
ENDCLASS.
