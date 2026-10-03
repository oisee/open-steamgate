CLASS ltcl_owned DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    DATA mv_mem TYPE xstring.
    CLASS-DATA escaped_static TYPE xstring.
    METHODS static_changing FOR TESTING.
    METHODS change_generic CHANGING cv_mem TYPE any.
    METHODS snapshots FOR TESTING.
    METHODS self_append FOR TESTING.
    METHODS value_input FOR TESTING.
    METHODS append_and_clear FOR TESTING.
    METHODS stores FOR TESTING.
    METHODS changing_alias FOR TESTING.
    METHODS change CHANGING cv_mem TYPE xstring.
    METHODS save_after_store IMPORTING VALUE(iv_mem) TYPE xstring
      RETURNING VALUE(rv_mem) TYPE xstring.
ENDCLASS.
CLASS ltcl_owned IMPLEMENTATION.
  METHOD change_generic.
    DATA bytes TYPE xstring VALUE 'AABB'.
    cv_mem = bytes.
  ENDMETHOD.
  METHOD static_changing.
    DATA saved TYPE xstring.
    escaped_static = '1234'.
    saved = escaped_static.
    change_generic( CHANGING cv_mem = escaped_static ).
    cl_abap_unit_assert=>assert_equals( act = saved exp = '1234' ).
    saved = escaped_static.
    cl_abap_unit_assert=>assert_equals( act = saved exp = 'AABB' ).
  ENDMETHOD.
  METHOD self_append.
    DATA mem TYPE xstring.
    DATA saved TYPE xstring.
    mem = '01AB'.
    CONCATENATE mem mem INTO mem IN BYTE MODE.
    saved = mem.
    cl_abap_unit_assert=>assert_equals( act = saved exp = '01AB01AB' ).
  ENDMETHOD.
  METHOD snapshots.
    DATA replacement TYPE x LENGTH 2 VALUE 'ABCD'.
    DATA b TYPE xstring.
    mv_mem = '12345678'.
    b = mv_mem.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF mv_mem WITH replacement IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = b exp = '12345678' ).
    b = mv_mem.
    cl_abap_unit_assert=>assert_equals( act = b exp = '12ABCD78' ).
  ENDMETHOD.
  METHOD save_after_store.
    DATA replacement TYPE x LENGTH 1 VALUE 'FF'.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF mv_mem WITH replacement IN BYTE MODE.
    rv_mem = iv_mem.
  ENDMETHOD.
  METHOD value_input.
    DATA saved TYPE xstring.
    mv_mem = '12345678'.
    saved = save_after_store( mv_mem ).
    cl_abap_unit_assert=>assert_equals( act = saved exp = '12345678' ).
    saved = mv_mem.
    cl_abap_unit_assert=>assert_equals( act = saved exp = 'FF345678' ).
  ENDMETHOD.
  METHOD append_and_clear.
    DATA a TYPE x LENGTH 2 VALUE '5678'.
    DATA b TYPE x LENGTH 2 VALUE '9ABC'.
    DATA prefix TYPE x LENGTH 1 VALUE 'FF'.
    DATA suffix TYPE x LENGTH 2 VALUE 'AABB'.
    DATA part TYPE x LENGTH 2.
    DATA saved TYPE xstring.
    mv_mem = '1234'.
    CONCATENATE mv_mem a b INTO mv_mem IN BYTE MODE.
    part = mv_mem+4(2).
    cl_abap_unit_assert=>assert_equals( act = part exp = '9ABC' ).
    CONCATENATE prefix mv_mem INTO mv_mem IN BYTE MODE.
    saved = mv_mem.
    cl_abap_unit_assert=>assert_equals( act = saved exp = 'FF123456789ABC' ).
    CLEAR mv_mem.
    cl_abap_unit_assert=>assert_equals( act = xstrlen( mv_mem ) exp = 0 ).
    CONCATENATE mv_mem suffix INTO mv_mem IN BYTE MODE.
    saved = mv_mem.
    cl_abap_unit_assert=>assert_equals( act = saved exp = 'AABB' ).
  ENDMETHOD.
  METHOD stores.
    DATA replacement TYPE x LENGTH 1 VALUE 'AB'.
    DATA saved TYPE xstring.
    DATA off TYPE i.
    mv_mem = '0000000000000000'.
    DO 1000 TIMES.
      off = ( sy-index - 1 ) MOD 8.
      REPLACE SECTION OFFSET off LENGTH 1 OF mv_mem WITH replacement IN BYTE MODE.
    ENDDO.
    saved = mv_mem.
    cl_abap_unit_assert=>assert_equals( act = saved exp = 'ABABABABABABABAB' ).
  ENDMETHOD.
  METHOD change.
    cv_mem = 'AABB'.
  ENDMETHOD.
  METHOD changing_alias.
    DATA replacement TYPE x LENGTH 1 VALUE 'FF'.
    DATA escaped_mem TYPE xstring.
    DATA before TYPE xstring.
    DATA after TYPE xstring.
    escaped_mem = '1234'.
    before = escaped_mem.
    change( CHANGING cv_mem = escaped_mem ).
    REPLACE SECTION OFFSET 0 LENGTH 1 OF escaped_mem WITH replacement IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = before exp = '1234' ).
    after = escaped_mem.
    cl_abap_unit_assert=>assert_equals( act = after exp = 'FFBB' ).
  ENDMETHOD.
ENDCLASS.
