CLASS zcl_gogen_t_pdcmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdcmp IMPLEMENTATION.
  METHOD run.
    DATA lv_i TYPE i.
    DATA lv_s TYPE string.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p1 TYPE p LENGTH 8 DECIMALS 1.
    DATA lv_n TYPE n LENGTH 4.

* a comparison with arithmetic: the calculation type of both sides
    lv_i = 30000.
    lv_s = `1`.
    TRY.
        IF lv_i * 86400 * 1000 > lv_s + 0.
          rv = `a:gt`.
        ELSE.
          rv = `a:le`.
        ENDIF.
      CATCH cx_sy_arithmetic_overflow.
        rv = `a:AO`.
    ENDTRY.
    lv_s = `2.6`.
    IF lv_s + 0 = 3.
      rv = rv && ` b:eq`.
    ELSE.
      rv = rv && ` b:ne`.
    ENDIF.
    IF lv_s = 3.
      rv = rv && ` c:eq`.
    ELSE.
      rv = rv && ` c:ne`.
    ENDIF.
    lv_p2 = '1.6'.
    IF lv_p2 * 2 > 3.
      rv = rv && ` d:gt`.
    ELSE.
      rv = rv && ` d:le`.
    ENDIF.
    lv_i = 3.
    IF lv_i / 2 = lv_p2 - '0.1'.
      rv = rv && ` e:eq`.
    ELSE.
      rv = rv && ` e:ne`.
    ENDIF.

* p into n, and ceil( ) into p
    lv_p2 = '-12.5'.
    TRY.
        lv_n = lv_p2.
        rv = rv && | n:{ lv_n }|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && ` n:CO`.
    ENDTRY.
    lv_p2 = '12345.6'.
    TRY.
        lv_n = lv_p2.
        rv = rv && |,{ lv_n }|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
    ENDTRY.
    lv_p2 = '-1.5'.
    lv_p1 = ceil( lv_p2 ).
    rv = rv && | f:{ lv_p1 }|.
    lv_p1 = floor( lv_p2 ).
    rv = rv && |,{ lv_p1 }|.
  ENDMETHOD.
ENDCLASS.
