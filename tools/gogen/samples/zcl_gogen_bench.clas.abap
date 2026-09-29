CLASS zcl_gogen_bench DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS plasma
      IMPORTING iv_frame      TYPE i
      RETURNING VALUE(rv_sum) TYPE i.
    CLASS-METHODS fib
      IMPORTING iv_n          TYPE i
      RETURNING VALUE(rv_fib) TYPE i.
    CLASS-METHODS primes
      IMPORTING iv_max          TYPE i
      RETURNING VALUE(rv_count) TYPE i.
    CLASS-METHODS table_sum
      IMPORTING iv_n          TYPE i
      RETURNING VALUE(rv_sum) TYPE i.
    CLASS-METHODS divide
      IMPORTING iv_a        TYPE i
                iv_b        TYPE i
      RETURNING VALUE(rv_r) TYPE i.
    CLASS-METHODS integer_div
      IMPORTING iv_a        TYPE i
                iv_b        TYPE i
      RETURNING VALUE(rv_r) TYPE i.
    CLASS-METHODS modulo
      IMPORTING iv_a        TYPE i
                iv_b        TYPE i
      RETURNING VALUE(rv_r) TYPE i.
    CLASS-METHODS float_to_int
      IMPORTING iv_f        TYPE f
      RETURNING VALUE(rv_r) TYPE i.
    CLASS-METHODS divide_into_float
      IMPORTING iv_a        TYPE i
                iv_b        TYPE i
      RETURNING VALUE(rv_r) TYPE f.
ENDCLASS.

CLASS zcl_gogen_bench IMPLEMENTATION.

  METHOD plasma.
    DATA lv_x TYPE i.
    DATA lv_y TYPE i.
    DATA lv_fx TYPE f.
    DATA lv_fy TYPE f.
    DATA lv_t TYPE f.
    DATA lv_v TYPE f.
    DATA lv_c TYPE i.
    lv_t = iv_frame.
    DO 200 TIMES.
      lv_y = sy-index - 1.
      lv_fy = lv_y.
      DO 320 TIMES.
        lv_x = sy-index - 1.
        lv_fx = lv_x.
        lv_v = sin( lv_fx / 16 ) + sin( lv_fy / 8 ) + sin( ( lv_fx + lv_fy + lv_t ) / 16 )
             + cos( sqrt( lv_fx * lv_fx + lv_fy * lv_fy ) / 8 ).
        lv_c = lv_v * 32.
        rv_sum = rv_sum + lv_c MOD 256.
      ENDDO.
    ENDDO.
  ENDMETHOD.

  METHOD fib.
    IF iv_n < 2.
      rv_fib = iv_n.
    ELSE.
      rv_fib = fib( iv_n - 1 ) + fib( iv_n - 2 ).
    ENDIF.
  ENDMETHOD.

  METHOD primes.
    DATA lv_n TYPE i.
    DATA lv_d TYPE i.
    DATA lv_is TYPE i.
    lv_n = 2.
    WHILE lv_n <= iv_max.
      lv_is = 1.
      lv_d = 2.
      WHILE lv_d * lv_d <= lv_n.
        IF lv_n MOD lv_d = 0.
          lv_is = 0.
          EXIT.
        ENDIF.
        lv_d = lv_d + 1.
      ENDWHILE.
      IF lv_is = 1.
        rv_count = rv_count + 1.
      ENDIF.
      lv_n = lv_n + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD table_sum.
    DATA lt_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_i TYPE i.
    DATA lv_val TYPE i.
    DO iv_n TIMES.
      lv_i = sy-index * 7 MOD 1000.
      APPEND lv_i TO lt_tab.
    ENDDO.
    LOOP AT lt_tab INTO lv_val.
      rv_sum = rv_sum + lv_val - sy-tabix MOD 3.
    ENDLOOP.
    READ TABLE lt_tab INDEX 5 INTO lv_val.
    rv_sum = rv_sum + lv_val * lines( lt_tab ).
  ENDMETHOD.

  METHOD divide.
    rv_r = iv_a / iv_b.
  ENDMETHOD.

  METHOD integer_div.
    rv_r = iv_a DIV iv_b.
  ENDMETHOD.

  METHOD modulo.
    rv_r = iv_a MOD iv_b.
  ENDMETHOD.

  METHOD float_to_int.
    rv_r = iv_f.
  ENDMETHOD.

  METHOD divide_into_float.
    rv_r = iv_a / iv_b.
  ENDMETHOD.

ENDCLASS.
