CLASS zcl_gogen_t_tryflow DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS early IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS from_catch IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS nested RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_tryflow IMPLEMENTATION.
  METHOD early.
    rv = `a`.
    TRY.
        IF iv > 0.
          rv = `b`.
          RETURN.
        ENDIF.
        rv = `c`.
      CATCH cx_sy_zerodivide.
        rv = `z`.
    ENDTRY.
    rv = |{ rv }d|.
  ENDMETHOD.
  METHOD from_catch.
    DATA lv TYPE i.
    rv = `a`.
    TRY.
        lv = 1 / iv.
      CATCH cx_sy_zerodivide.
        rv = `caught`.
        RETURN.
    ENDTRY.
    rv = |{ rv }{ lv }|.
  ENDMETHOD.
  METHOD nested.
    DO 5 TIMES.
      TRY.
          TRY.
              IF sy-index = 2.
                CONTINUE.
              ENDIF.
              IF sy-index = 4.
                EXIT.
              ENDIF.
            CATCH cx_sy_zerodivide.
          ENDTRY.
        CATCH cx_sy_arithmetic_overflow.
      ENDTRY.
      rv = |{ rv }{ sy-index }|.
    ENDDO.
    rv = |{ rv }!|.
  ENDMETHOD.
  METHOD run.
    rv = |{ early( 1 ) } { early( 0 ) } { from_catch( 0 ) } { from_catch( 1 ) } { nested( ) }|.
  ENDMETHOD.
ENDCLASS.
