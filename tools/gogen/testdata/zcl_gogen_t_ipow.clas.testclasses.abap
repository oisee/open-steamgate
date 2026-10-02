CLASS ltcl_power DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
 PRIVATE SECTION.
  METHODS powers FOR TESTING.
  METHODS overflow FOR TESTING.
  METHODS int8 FOR TESTING.
  METHODS packed FOR TESTING.
  METHODS numeric FOR TESTING.
  METHODS logical FOR TESTING.
ENDCLASS.
CLASS ltcl_power IMPLEMENTATION.
 METHOD powers.
  DATA e TYPE i.
  DATA expected TYPE i VALUE 1.
  DATA actual TYPE i.
  DO 31 TIMES.
   e = sy-index - 1.
   actual = ipow( base = 2 exp = e ).
   cl_abap_unit_assert=>assert_equals( act = actual exp = expected ).
   IF e < 30.
    expected = expected * 2.
   ENDIF.
  ENDDO.
 ENDMETHOD.
 METHOD overflow.
  DATA actual TYPE i.
  TRY.
   actual = ipow( base = 2 exp = 31 ).
   cl_abap_unit_assert=>fail( msg = 'IPOW must overflow' ).
  CATCH cx_sy_arithmetic_overflow.
  ENDTRY.
 ENDMETHOD.
 METHOD int8.
  DATA base TYPE int8 VALUE 2.
  DATA actual TYPE int8.
  actual = ipow( base = base exp = 62 ).
  cl_abap_unit_assert=>assert_equals( act = actual exp = CONV int8( 4611686018427387904 ) ).
  TRY.
   actual = ipow( base = base exp = 63 ).
   cl_abap_unit_assert=>fail( msg = 'INT8 IPOW must overflow' ).
  CATCH cx_sy_arithmetic_overflow.
  ENDTRY.
  base = -2.
  actual = ipow( base = base exp = 63 ).
  cl_abap_unit_assert=>assert_equals( act = actual exp = CONV int8( -9223372036854775808 ) ).
 ENDMETHOD.
 METHOD packed.
  DATA base TYPE p LENGTH 8 DECIMALS 2 VALUE '1.5'.
  DATA actual TYPE p LENGTH 8 DECIMALS 2.
  actual = ipow( base = base exp = 3 ).
  cl_abap_unit_assert=>assert_equals( act = actual exp = '3.38' ).
 ENDMETHOD.
 METHOD logical.
  DATA actual TYPE xstring.
  actual = boolx( bool = 1 = 1 bit = 9 ).
  cl_abap_unit_assert=>assert_equals( act = actual exp = CONV xstring( '0080' ) ).
  actual = boolx( bool = 1 = 1 bit = -9 ).
  cl_abap_unit_assert=>assert_equals( act = actual exp = CONV xstring( 'FF80' ) ).
  actual = boolx( bool = 1 = 2 bit = 9 ).
  cl_abap_unit_assert=>assert_initial( actual ).
 ENDMETHOD.
 METHOD numeric.
  DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '-1.75'.
  cl_abap_unit_assert=>assert_equals( act = nmin( val1 = 4 val2 = -2 ) exp = -2 ).
  cl_abap_unit_assert=>assert_equals( act = nmax( val1 = 4 val2 = -2 ) exp = 4 ).
  cl_abap_unit_assert=>assert_equals( act = sign( p ) exp = -1 ).
  cl_abap_unit_assert=>assert_equals( act = frac( p ) exp = '-0.75' ).
  cl_abap_unit_assert=>assert_equals( act = trunc( p ) exp = -1 ).
  cl_abap_unit_assert=>assert_equals( act = ceil( p ) exp = -1 ).
  cl_abap_unit_assert=>assert_equals( act = floor( p ) exp = -2 ).
  cl_abap_unit_assert=>assert_equals( act = boolc( 1 = 1 ) exp = 'X' ).
  cl_abap_unit_assert=>assert_equals( act = boolc( 1 = 2 ) exp = ` ` ).
 ENDMETHOD.
ENDCLASS.
