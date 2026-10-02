CLASS ltcl_mem DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS mem8 FOR TESTING.
    METHODS mem16 FOR TESTING.
    METHODS mem32 FOR TESTING.
ENDCLASS.
CLASS ltcl_mem IMPLEMENTATION.
  METHOD mem8.
    DATA mem TYPE xstring.
    DATA w TYPE x LENGTH 1.
    DATA got TYPE x LENGTH 1.
    DATA off TYPE i VALUE 2.
    DATA length TYPE i VALUE 1.
    mem = '0000000000000000'.
    w = '7F'.
    REPLACE SECTION OFFSET off LENGTH length OF mem WITH w IN BYTE MODE.
    got = mem+off(length).
    cl_abap_unit_assert=>assert_equals( act = got exp = w ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( mem ) exp = 8 ).
  ENDMETHOD.
  METHOD mem16.
    DATA mem TYPE xstring.
    DATA w TYPE x LENGTH 2.
    DATA got TYPE x LENGTH 2.
    DATA off TYPE i VALUE 2.
    DATA length TYPE i VALUE 2.
    mem = '0000000000000000'.
    w = '3412'.
    REPLACE SECTION OFFSET off LENGTH length OF mem WITH w IN BYTE MODE.
    got = mem+off(length).
    cl_abap_unit_assert=>assert_equals( act = got exp = w ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( mem ) exp = 8 ).
  ENDMETHOD.
  METHOD mem32.
    DATA mem TYPE xstring.
    DATA w TYPE x LENGTH 4.
    DATA got TYPE x LENGTH 4.
    DATA off TYPE i VALUE 2.
    DATA length TYPE i VALUE 4.
    mem = '0000000000000000'.
    w = '78563412'.
    REPLACE SECTION OFFSET off LENGTH length OF mem WITH w IN BYTE MODE.
    got = mem+off(length).
    cl_abap_unit_assert=>assert_equals( act = got exp = w ).
    cl_abap_unit_assert=>assert_equals( act = xstrlen( mem ) exp = 8 ).
  ENDMETHOD.
ENDCLASS.
