CLASS zcl_gogen_t_pdcalc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdcalc IMPLEMENTATION.
  METHOD run.
    DATA lv_a TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p0 TYPE p LENGTH 8 DECIMALS 0.
    DATA lv_p14 TYPE p LENGTH 16 DECIMALS 14.
    DATA lv_p16 TYPE p LENGTH 16 DECIMALS 0.
    DATA lv_small TYPE p LENGTH 3 DECIMALS 2.
    DATA lv_hash TYPE p LENGTH 8 DECIMALS 0.
    DATA lv_i TYPE i.
    DATA lv_i8 TYPE int8.
    DATA lv_f TYPE f.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 10.

* products, rounded into the target
    lv_a = '1.25'.
    lv_p2 = lv_a * lv_a.
    rv = |mul:{ lv_p2 }|.
    lv_a = '1.35'.
    lv_p2 = lv_a * lv_a.
    rv = rv && |,{ lv_p2 }|.
    lv_a = '-1.25'.
    lv_p2 = lv_a * lv_a * lv_a.
    rv = rv && |,{ lv_p2 }|.

* division of integers into p: calculation type p (the target)
    lv_p2 = 1 / 3.
    rv = rv && | div:{ lv_p2 }|.
    lv_p2 = 2 / 3.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = -2 / 3.
    rv = rv && |,{ lv_p2 }|.
    lv_p0 = 7 / 2.
    rv = rv && |,{ lv_p0 }|.
    lv_p0 = -7 / 2.
    rv = rv && |,{ lv_p0 }|.
    lv_p0 = 5 / 2.
    rv = rv && |,{ lv_p0 }|.
    lv_p0 = 2 / 3 * 3.
    rv = rv && |,{ lv_p0 }|.
    lv_p2 = 1 / 3 * 3.
    rv = rv && |,{ lv_p2 }|.
    lv_i = 7.
    lv_p2 = lv_i / 2.
    rv = rv && |,{ lv_p2 }|.

* the precision of an intermediate result
    lv_p14 = 1 / 3.
    rv = rv && | prec:{ lv_p14 }|.
    lv_p14 = 2 / 3.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = 1 / 3 * 3.
    rv = rv && |,{ lv_p14 }|.
    lv_p16 = 1 / 3 * 100000000000000000000000000000.
    rv = rv && |,{ lv_p16 }|.
    lv_p16 = 2 / 3 * 100000000000000000000000000000.
    rv = rv && |,{ lv_p16 }|.
    lv_p16 = 1 / 7 * 1000000000000000000000.
    rv = rv && |,{ lv_p16 }|.
    lv_a = '0.07'.
    lv_p16 = lv_a / 3 * 1000000000000000000000000000.
    rv = rv && |,{ lv_p16 }|.

* DIV and MOD in calculation type p
    lv_a = '7.5'.
    lv_p2 = lv_a DIV 2.
    rv = rv && | dm:{ lv_p2 }|.
    lv_p2 = lv_a MOD 2.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = lv_a DIV -2.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = lv_a MOD -2.
    rv = rv && |,{ lv_p2 }|.
    lv_a = '-7.5'.
    lv_p2 = lv_a DIV 2.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = lv_a MOD 2.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = lv_a DIV -2.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = lv_a MOD -2.
    rv = rv && |,{ lv_p2 }|.
    lv_a = '7.5'.
    lv_p2 = lv_a MOD '0.4'.
    rv = rv && |,{ lv_p2 }|.
    lv_p0 = 7 DIV -2.
    rv = rv && |,{ lv_p0 }|.
    lv_p0 = -7 MOD 2.
    rv = rv && |,{ lv_p0 }|.
    lv_hash = 7.
    lv_i = 30.
    DO 4 TIMES.
      lv_hash = ( lv_hash * 97 + lv_i + 1 ) MOD 999999937.
      lv_i = lv_i + 11.
    ENDDO.
    rv = rv && |,{ lv_hash }|.
    lv_hash = 999999936.
    lv_hash = ( lv_hash * 97 + 60 + 1 ) MOD 999999937.
    rv = rv && |,{ lv_hash }|.

* zero
    TRY.
        lv_p2 = lv_a / 0.
        rv = rv && | z:{ lv_p2 }|.
      CATCH cx_sy_zerodivide.
        rv = rv && ` z:ZD`.
    ENDTRY.
    CLEAR lv_a.
    TRY.
        lv_p2 = lv_a / 0.
        rv = rv && |,{ lv_p2 }|.
      CATCH cx_sy_zerodivide.
        rv = rv && `,ZD`.
    ENDTRY.
    lv_a = '7.5'.
    TRY.
        lv_p2 = lv_a MOD 0.
        rv = rv && |,{ lv_p2 }|.
      CATCH cx_sy_zerodivide.
        rv = rv && `,ZD`.
    ENDTRY.
    TRY.
        lv_p2 = lv_a DIV 0.
        rv = rv && |,{ lv_p2 }|.
      CATCH cx_sy_zerodivide.
        rv = rv && `,ZD`.
    ENDTRY.

* overflow
    lv_p16 = '9999999999999999999999999999999'.
    TRY.
        lv_p16 = lv_p16 + 1.
        rv = rv && | ov:{ lv_p16 }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && ` ov:AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && ` ov:CO`.
    ENDTRY.
    lv_p16 = '9999999999999999999999999999999'.
    TRY.
        lv_p16 = lv_p16 * 10 / 10.
        rv = rv && |,{ lv_p16 }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.
    lv_i = 5.
    TRY.
        lv_small = lv_i * 1000.
        rv = rv && |,{ lv_small }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.
    lv_p0 = 5000.
    TRY.
        lv_small = lv_p0 + 0.
        rv = rv && |,{ lv_small }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.
    lv_p0 = 3000000000.
    TRY.
        lv_i = lv_p0 * 1.
        rv = rv && |,{ lv_i }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.
    lv_a = '999999.99'.
    TRY.
        lv_small = lv_a / 1000.
        rv = rv && |,{ lv_small }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.

* character operands: calculation type p
    lv_s = `7`.
    lv_i = lv_s / 2 * 2.
    rv = rv && | ch:{ lv_i }|.
    lv_s = `1728003600000`.
    lv_i = lv_s / 1000 / 86400.
    rv = rv && |,{ lv_i }|.
    lv_s = `-1000`.
    lv_i = lv_s / 1000 / 86400.
    rv = rv && |,{ lv_i }|.
    lv_s = `-1500`.
    lv_i = lv_s / 1000.
    rv = rv && |,{ lv_i }|.
    lv_i = 3.
    lv_p2 = lv_i * '1.25'.
    rv = rv && |,{ lv_p2 }|.
    lv_i = lv_i * '1.25'.
    rv = rv && |,{ lv_i }|.
    lv_c = '2.5'.
    lv_i = lv_c * 3.
    rv = rv && |,{ lv_i }|.
    lv_s = `-0.4`.
    IF lv_s < 0.
      rv = rv && `,lt`.
    ELSE.
      rv = rv && `,ge`.
    ENDIF.
    lv_s = `1.4`.
    IF lv_s = 1.
      rv = rv && `,eq`.
    ELSE.
      rv = rv && `,ne`.
    ENDIF.

* f and int8 operands
    lv_f = '0.1'.
    lv_a = '0.2'.
    lv_p2 = lv_f + lv_a.
    rv = rv && | f:{ lv_p2 }|.
    lv_f = '2.675'.
    lv_p2 = lv_f * 1.
    rv = rv && |,{ lv_p2 }|.
    lv_i8 = 5000000000.
    lv_p16 = lv_i8 * 3.
    rv = rv && | i8:{ lv_p16 }|.
    lv_p2 = lv_i8 / 3.
    rv = rv && |,{ lv_p2 }|.

* minus, sums
    lv_a = '1.25'.
    lv_p2 = - lv_a.
    rv = rv && | neg:{ lv_p2 }|.
    CLEAR lv_p2.
    DO 10 TIMES.
      lv_p2 = lv_p2 + '0.1'.
    ENDDO.
    rv = rv && | sum:{ lv_p2 }|.
  ENDMETHOD.
ENDCLASS.
