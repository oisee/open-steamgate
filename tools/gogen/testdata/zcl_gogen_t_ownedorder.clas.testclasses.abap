CLASS ltcl_order DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    DATA mv_mem TYPE xstring.
    METHODS sibling_call FOR TESTING.
    METHODS comb IMPORTING VALUE(iv_a) TYPE xstring VALUE(iv_b) TYPE xstring
      RETURNING VALUE(r) TYPE xstring.
    METHODS grow RETURNING VALUE(r) TYPE xstring.
ENDCLASS.
CLASS ltcl_order IMPLEMENTATION.
  METHOD sibling_call.
    DATA b TYPE xstring.
    mv_mem = '01'.
    b = comb( iv_a = mv_mem iv_b = grow( ) ).
    cl_abap_unit_assert=>assert_equals( act = b exp = '01FFEE' ).
  ENDMETHOD.
  METHOD grow.
    DATA ff TYPE x LENGTH 1 VALUE 'FF'.
    CONCATENATE mv_mem ff INTO mv_mem IN BYTE MODE.
    r = 'EE'.
  ENDMETHOD.
  METHOD comb.
    CONCATENATE iv_a iv_b INTO r IN BYTE MODE.
  ENDMETHOD.
ENDCLASS.
