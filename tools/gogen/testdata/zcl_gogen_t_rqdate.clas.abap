CLASS zcl_gogen_t_rqdate DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rqdate IMPLEMENTATION.
  METHOD run.
    DATA ld TYPE d.
    DATA ld0 TYPE d.
    DATA ld1 TYPE d.
    DATA ld2 TYPE d VALUE '19700101'.
    DATA li TYPE i.
    DATA li2 TYPE i.
    DATA lv TYPE string.
    DATA ls TYPE string.
    DATA lt TYPE t VALUE '123456'.
    DATA lt_d TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    ld = 'ABC'.
    rv = |a[{ ld }]|.
    ld1 = '20260917'.
    li = ld1 - ld2.
    li2 = ld0 - ld2.
    rv = |{ rv };b{ li },{ li2 }|.
    li = ( ld1 / 7 ) * 7.
    rv = |{ rv };c{ li }|.
    li = 20713.
    TRY.
        lv = |{ ( li * 86400 + 0 ) * 1000 }|.
      CATCH cx_sy_arithmetic_overflow.
        lv = 'OVF'.
    ENDTRY.
    rv = |{ rv };d{ lv }|.
    li = lt(2).
    li2 = lt+2(2).
    rv = |{ rv };k{ li },{ li2 };|.
    APPEND '00000000' TO lt_d.
    APPEND '00010101' TO lt_d.
    APPEND '00010102' TO lt_d.
    APPEND '15821004' TO lt_d.
    APPEND '15821015' TO lt_d.
    APPEND '19700101' TO lt_d.
    APPEND '20000229' TO lt_d.
    APPEND '20260917' TO lt_d.
    APPEND '99991231' TO lt_d.
    APPEND '20260230' TO lt_d.
    APPEND 'ABC' TO lt_d.
    APPEND '1900022' TO lt_d.
    LOOP AT lt_d INTO ls.
      ld = ls.
      li = ld.
      rv = |{ rv }{ ls }={ li };|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
