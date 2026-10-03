* Documentation-backed integer arithmetic; no new SAP measurement.
CLASS zcl_gogen_t_int8arith DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_int8arith IMPLEMENTATION.
 METHOD run.
 DATA a TYPE int8.
 DATA b TYPE int8.
 DATA v TYPE int8.
 a = -7. b = 2.
 v = a DIV b. rv = |{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 b = -2.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = 7.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -9223372036854775808. b = -1.
 TRY. v = a DIV b. rv = rv && '/bad-div'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/div-overflow'. ENDTRY.
 TRY. v = a / b. rv = rv && '/bad-round'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/round-overflow'. ENDTRY.
 v = a MOD b. rv = |{ rv }/{ v }|.
 b = -9223372036854775808.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -1.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = 9223372036854775807.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -9223372036854775808. b = 9223372036854775807.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -4611686018427387904. b = -9223372036854775808.
 v = a / b. rv = |{ rv }/{ v }|.
 a = a + 1.
 v = a / b. rv = |{ rv }/{ v }|.
 a = 4611686018427387904.
 v = a / b. rv = |{ rv }/{ v }|.
 b = 9223372036854775807.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -4611686018427387904.
 v = a / b. rv = |{ rv }/{ v }|.
 a = 9223372036854775807. b = 1.
 TRY. v = a + b. rv = rv && '/bad-add'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/add-overflow'. ENDTRY.
 a = -9223372036854775808.
 TRY. v = a - b. rv = rv && '/bad-sub'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/sub-overflow'. ENDTRY.
 b = -1.
 TRY. v = a * b. rv = rv && '/bad-mul'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/mul-overflow'. ENDTRY.
 a = 9223372036854775807.
 v = a + 4294967296 - 4294967296. rv = |{ rv }/{ v }|.
 a = -7.
 v = a DIV 4294967296. rv = |{ rv }/{ v }|.
 v = a MOD 4294967296. rv = |{ rv }/{ v }|.
 v = a * 4294967296. rv = |{ rv }/{ v }|.
 v = a + 4294967296. rv = |{ rv }/{ v }|.
 v = a / 4294967296. rv = |{ rv }/{ v }|.
 a = -9223372036854775808.
 TRY. v = -9223372036854775808 DIV -1. rv = rv && '/bad-packed-div'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/packed-div-overflow'. ENDTRY.
 TRY. v = - a. rv = rv && '/bad-neg'.
 CATCH cx_sy_arithmetic_overflow. rv = rv && '/neg-overflow'. ENDTRY.
 v = a * 4294967296 DIV 4294967296. rv = |{ rv }/{ v }|.
 a = 7.
 v = a / 4294967296 * 4294967296. rv = |{ rv }/{ v }|.
 a = 0. b = 0.
 v = a DIV b. rv = |{ rv }/{ v }|.
 v = a MOD b. rv = |{ rv }/{ v }|.
 v = a / b. rv = |{ rv }/{ v }|.
 a = -1.
 TRY. v = a DIV b. rv = rv && '/bad-zero-div'.
 CATCH cx_sy_zerodivide. rv = rv && '/zero-div'. ENDTRY.
 TRY. v = a MOD b. rv = rv && '/bad-zero-mod'.
 CATCH cx_sy_zerodivide. rv = rv && '/zero-mod'. ENDTRY.
 TRY. v = a / b. rv = rv && '/bad-zero-round'.
 CATCH cx_sy_zerodivide. rv = rv && '/zero-round'. ENDTRY.
 ENDMETHOD.
ENDCLASS.
