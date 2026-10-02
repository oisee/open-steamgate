CLASS zcl_gogen_t_ipow DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_ipow IMPLEMENTATION.
  METHOD run.
    DATA b TYPE int8.
    DATA p TYPE p LENGTH 8 DECIMALS 2.
    DATA v TYPE i.
    DATA e TYPE i.
    DO 31 TIMES.
      e = sy-index - 1.
      v = ipow( base = 2 exp = e ).
    ENDDO.
    rv = |{ v }|.
    TRY.
        v = ipow( base = 2 exp = 31 ).
        rv = rv && '/missing-overflow'.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && '/overflow'.
    ENDTRY.
    b = 2.
    b = ipow( base = b exp = 62 ).
    p = '1.5'.
    p = ipow( base = p exp = 3 ).
    rv = rv && |/{ b }/{ p }|.
  ENDMETHOD.
ENDCLASS.
