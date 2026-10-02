CLASS zcl_gogen_t_ipow DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_ipow IMPLEMENTATION.
  METHOD run.
    DATA b TYPE int8.
    DATA bytes TYPE xstring.
    DATA f TYPE f.
    DATA text TYPE string.
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
    bytes = boolx( bool = 1 = 1 bit = 9 ).
    IF bytes = CONV xstring( '0080' ).
      rv = rv && |/bytes:{ xstrlen( bytes ) }|.
    ENDIF.
    v = ipow( base = -2 exp = -1 ).
    b = ipow( base = 2 exp = -1 ).
    p = ipow( base = 2 exp = -1 ).
    f = ipow( base = 2 exp = -1 ).
    text = f.
    rv = rv && |/negative:{ v }/{ b }/{ p }/{ text }|.
    v = ipow( base = -2 exp = 31 ).
    text = v.
    rv = rv && |/minimum:{ text }|.
    b = ipow( base = 2 exp = 62 ).
    text = b.
    CONDENSE text.
    rv = rv && |/wide:{ text }|.
    TRY.
        v = ipow( base = 0 exp = -1 ).
        rv = rv && '/missing-zero-overflow'.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && '/zero-overflow'.
    ENDTRY.
    TRY.
        b = ipow( base = 3 exp = 40 ).
        rv = rv && '/missing-wide-overflow'.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && '/wide-overflow'.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
