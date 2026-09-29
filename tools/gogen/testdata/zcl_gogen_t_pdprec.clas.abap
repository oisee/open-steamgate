CLASS zcl_gogen_t_pdprec DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdprec IMPLEMENTATION.
  METHOD run.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p14 TYPE p LENGTH 16 DECIMALS 14.
    DATA lv_e TYPE p LENGTH 16 DECIMALS 14.
    DATA lv_p16 TYPE p LENGTH 16 DECIMALS 0.
    DATA lv_c3 TYPE c LENGTH 3.
    DATA lv_c4 TYPE c LENGTH 4.
    DATA lv_c5 TYPE c LENGTH 5.
    DATA lv_c8 TYPE c LENGTH 8.
    DATA lv_c9 TYPE c LENGTH 9.

* p into c fields too short for the value and its sign place
    lv_p2 = '1.50'.
    lv_c4 = lv_p2.
    lv_c5 = lv_p2.
    rv = |c:[{ lv_c4 }][{ lv_c5 }]|.
    lv_p2 = '-1.50'.
    lv_c5 = lv_p2.
    lv_c4 = lv_p2.
    lv_c3 = lv_p2.
    rv = rv && |[{ lv_c5 }][{ lv_c4 }][{ lv_c3 }]|.
    lv_p2 = '12345.67'.
    lv_c8 = lv_p2.
    lv_c9 = lv_p2.
    rv = rv && |[{ lv_c8 }][{ lv_c9 }]|.
    lv_p2 = '-12345.67'.
    lv_c3 = lv_p2.
    lv_c8 = lv_p2.
    rv = rv && |[{ lv_c3 }][{ lv_c8 }]|.

* the decimals an intermediate result keeps
    lv_p14 = 2 * 10000000000000000000000000000 / 3 - 6666666666666666666666666666.
    rv = rv && | d:{ lv_p14 }|.
    lv_p14 = 2 / 3 * 10000000000000000000000000000 - 6666666666666666666666666666.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = 2 * 1000000000000000 / 3 - 666666666666666.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = 2 / 3 * 1000000000000000 - 666666666666666.
    rv = rv && |,{ lv_p14 }|.
    lv_e = '0.00000000000001'.
    lv_p14 = lv_e * lv_e * lv_e / lv_e / lv_e.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = lv_e * lv_e / lv_e.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = '0.123456789012345678901' * 10000000000.
    rv = rv && |,{ lv_p14 }|.
    lv_p14 = 1 / 3 / 1000000000000 * 1000000000000.
    rv = rv && |,{ lv_p14 }|.

* how far an intermediate result may grow
    lv_p16 = '9999999999999999999999999999999'.
    TRY.
        lv_p16 = lv_p16 * lv_p16 / lv_p16.
        rv = rv && | g:{ lv_p16 }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && ` g:AO`.
    ENDTRY.
    lv_p16 = '9999999999999999999999999999999'.
    TRY.
        lv_p16 = lv_p16 * lv_p16 * 10 / lv_p16 / 10.
        rv = rv && |,{ lv_p16 }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
    ENDTRY.
    lv_p16 = '9999999999999999999999999999999'.
    TRY.
        lv_p16 = lv_p16 * lv_p16 * 100 / lv_p16 / 100.
        rv = rv && |,{ lv_p16 }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
    ENDTRY.

  ENDMETHOD.
ENDCLASS.
