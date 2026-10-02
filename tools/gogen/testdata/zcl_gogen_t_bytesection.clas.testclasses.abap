CLASS ltcl_section DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS r1 FOR TESTING.
    METHODS r2 FOR TESTING.
    METHODS r3 FOR TESTING.
    METHODS r4 FOR TESTING.
    METHODS r5 FOR TESTING.
    METHODS r6 FOR TESTING.
    METHODS f1 FOR TESTING.
    METHODS f2 FOR TESTING.
    METHODS f3 FOR TESTING.
    METHODS f4 FOR TESTING.
    METHODS f5 FOR TESTING.
    METHODS defaults FOR TESTING.
    METHODS length_only FOR TESTING.
    METHODS offset_only FOR TESTING.
    METHODS fixed_x FOR TESTING.
ENDCLASS.
CLASS ltcl_section IMPLEMENTATION.
  METHOD r1.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '1122'.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AA1122DD' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD r2.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AA11DD' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD r3.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '112233'.
    REPLACE SECTION OFFSET 1 LENGTH 1 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AA112233CCDD' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD r4.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = '11BBCCDD' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD r5.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION OFFSET 4 LENGTH 0 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AABBCCDD11' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD r6.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    DATA caught TYPE i.
    xs = 'AABBCCDD'.
    w = '11'.
    TRY.
        REPLACE SECTION OFFSET 3 LENGTH 2 OF xs WITH w IN BYTE MODE.
      CATCH cx_sy_range_out_of_bounds.
        caught = 1.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = caught exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AABBCCDD' ).
  ENDMETHOD.
  METHOD f1.
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i VALUE 77.
    DATA ml TYPE i VALUE 88.
    xs = 'AABBCCAABBCC'.
    p = 'AABB'.
    FIND p IN SECTION OFFSET 0 LENGTH 6 OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = m exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = ml exp = 2 ).
  ENDMETHOD.
  METHOD f2.
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i VALUE 77.
    DATA ml TYPE i VALUE 88.
    xs = 'AABBCCAABBCC'.
    p = 'AABB'.
    FIND p IN SECTION OFFSET 1 LENGTH 5 OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = m exp = 3 ).
    cl_abap_unit_assert=>assert_equals( act = ml exp = 2 ).
  ENDMETHOD.
  METHOD f3.
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i VALUE 77.
    DATA ml TYPE i VALUE 88.
    xs = 'AABBCCAABBCC'.
    p = 'AABB'.
    FIND p IN SECTION OFFSET 1 LENGTH 3 OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
    cl_abap_unit_assert=>assert_equals( act = m exp = 77 ).
    cl_abap_unit_assert=>assert_equals( act = ml exp = 88 ).
  ENDMETHOD.
  METHOD f4.
    DATA xs TYPE xstring.
    DATA p TYPE xstring.
    DATA m TYPE i VALUE 77.
    DATA ml TYPE i VALUE 88.
    xs = 'AABBCCAABBCC'.
    p = 'ABBC'.
    FIND p IN SECTION OFFSET 0 LENGTH 6 OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
    cl_abap_unit_assert=>assert_equals( act = m exp = 77 ).
    cl_abap_unit_assert=>assert_equals( act = ml exp = 88 ).
  ENDMETHOD.
  METHOD f5.
    DATA xs TYPE xstring.
    DATA p TYPE x LENGTH 1 VALUE 'AA'.
    DATA caught TYPE i.
    xs = 'AABBCC'.
    TRY.
        FIND p IN SECTION OFFSET 2 LENGTH 2 OF xs IN BYTE MODE.
      CATCH cx_sy_range_out_of_bounds.
        caught = 1.
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = caught exp = 1 ).
  ENDMETHOD.
  METHOD defaults.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION LENGTH 4 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = '11' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD length_only.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION LENGTH 2 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = '11CCDD' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD offset_only.
    DATA xs TYPE xstring.
    DATA w TYPE xstring.
    xs = 'AABBCCDD'.
    w = '11'.
    REPLACE SECTION OFFSET 2 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AABB11' ).
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
  ENDMETHOD.
  METHOD fixed_x.
    DATA xs TYPE x LENGTH 4 VALUE 'AABBCCDD'.
    DATA w TYPE x LENGTH 1 VALUE '11'.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF xs WITH w IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = xs exp = 'AA11DD00' ).
  ENDMETHOD.
ENDCLASS.
