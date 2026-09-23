CLASS zcl_gogen_t_packed DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_packed IMPLEMENTATION.
  METHOD run.
    DATA lv_days TYPE i VALUE 20000.
    DATA lv_sec TYPE i VALUE 3600.
    DATA lv_ms TYPE p LENGTH 16 DECIMALS 0.
    DATA lv_small TYPE p LENGTH 2 DECIMALS 0.
    DATA lv_neg TYPE p LENGTH 8 DECIMALS 0.
    lv_ms = ( lv_days * 86400 + lv_sec ) * 1000.
    lv_neg = lv_sec - lv_days.
    rv = |ms:{ lv_ms } neg:{ lv_neg }|.
    TRY.
        lv_small = lv_days.
        rv = rv && | small:{ lv_small }|.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && ` small:arith`.
      CATCH cx_sy_conversion_overflow.
        rv = rv && ` small:conv`.
    ENDTRY.
    lv_small = 999.
    rv = rv && | max:{ lv_small }|.
  ENDMETHOD.
ENDCLASS.
