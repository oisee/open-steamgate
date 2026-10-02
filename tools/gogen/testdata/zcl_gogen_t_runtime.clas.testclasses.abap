CLASS ltcl_runtime DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS elapsed FOR TESTING.
ENDCLASS.
CLASS ltcl_runtime IMPLEMENTATION.
  METHOD elapsed.
    DATA before TYPE i.
    DATA after TYPE i.
    DATA delta TYPE i.
    DATA total TYPE i.
    GET RUN TIME FIELD before.
    DO 10000 TIMES.
      total = total + 1.
    ENDDO.
    GET RUN TIME FIELD after.
    delta = after - before.
    cl_abap_unit_assert=>assert_equals( act = total exp = 10000 ).
    cl_abap_unit_assert=>assert_true( act = boolc( delta >= 0 ) ).
  ENDMETHOD.
ENDCLASS.
