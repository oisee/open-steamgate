CLASS zcl_gogen_t_pdfmt DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS generic IMPORTING iv TYPE any RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdfmt IMPLEMENTATION.
  METHOD generic.
    DATA lv_kind TYPE c LENGTH 1.
    DATA lv_s TYPE string.
    DESCRIBE FIELD iv TYPE lv_kind.
    lv_s = iv.
    rv = |{ lv_kind }/{ iv }/[{ lv_s }]|.
    IF iv IS INITIAL.
      rv = rv && `/ini`.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p1 TYPE p LENGTH 8 DECIMALS 1.
    DATA lv_p3 TYPE p LENGTH 8 DECIMALS 3.
    DATA lv_p0 TYPE p LENGTH 8 DECIMALS 0.
    DATA lv_p14 TYPE p LENGTH 16 DECIMALS 14.
    DATA lv_ref TYPE REF TO data.
    DATA lv_i TYPE i.
    DATA lv_f TYPE f.
    DATA lv_s TYPE string.
    FIELD-SYMBOLS <lv_any> TYPE any.

    rv = |t:{ lv_p2 },{ lv_p0 },{ lv_p14 }|.
    lv_p2 = '1.5'.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = '-1.5'.
    rv = rv && |,{ lv_p2 }|.
    lv_p3 = '0.005'.
    rv = rv && |,{ lv_p3 }|.
    lv_p2 = '-0.05'.
    rv = rv && |,{ lv_p2 }|.
    lv_p0 = -42.
    rv = rv && |,{ lv_p0 }|.
    lv_p14 = 1 / 3.
    rv = rv && |,{ lv_p14 }|.

    lv_p2 = '1.25'.
    rv = rv && | d:{ lv_p2 DECIMALS = 1 },{ lv_p2 DECIMALS = 3 },{ lv_p2 DECIMALS = 0 }|.
    lv_p2 = '-1.25'.
    rv = rv && |,{ lv_p2 DECIMALS = 1 }|.
    lv_p2 = '2.50'.
    rv = rv && |,{ lv_p2 DECIMALS = 0 }|.
    lv_p0 = 42.
    rv = rv && |,{ lv_p0 DECIMALS = 2 }|.
    lv_p2 = '1.5'.
    rv = rv && | n:{ lv_p2 NUMBER = RAW },[{ lv_p2 WIDTH = 8 ALIGN = RIGHT }]|.
    lv_p2 = '-1.5'.
    rv = rv && |,{ lv_p2 NUMBER = RAW }|.

    lv_p2 = '1.5'.
    lv_p1 = '1.5'.
    lv_p3 = '1.499'.
    lv_i = 1.
    lv_f = '1.5'.
    rv = rv && ` c:`.
    IF lv_p2 = lv_p1. rv = rv && `a`. ENDIF.
    IF lv_p2 > lv_i. rv = rv && `b`. ENDIF.
    IF lv_p2 < '1.6'. rv = rv && `c`. ENDIF.
    IF lv_p2 = '1.5'. rv = rv && `d`. ENDIF.
    IF lv_p2 = lv_f. rv = rv && `e`. ENDIF.
    IF lv_p3 < lv_p2. rv = rv && `f`. ENDIF.
    lv_s = `1.50`.
    IF lv_p2 = lv_s. rv = rv && `g`. ENDIF.
    IF lv_p2 <> lv_p3. rv = rv && `h`. ENDIF.
    lv_p2 = '-0.01'.
    IF lv_p2 < 0. rv = rv && `i`. ENDIF.
    CLEAR lv_p2.
    IF lv_p2 IS INITIAL. rv = rv && `j`. ENDIF.

    lv_p2 = '-1.5'.
    rv = rv && | fn:{ abs( lv_p2 ) },{ ceil( lv_p2 ) },{ floor( lv_p2 ) },{ trunc( lv_p2 ) },{ frac( lv_p2 ) },{ sign( lv_p2 ) }|.
    lv_p1 = abs( lv_p2 ).
    rv = rv && |,{ lv_p1 }|.
    lv_p1 = frac( lv_p2 ).
    rv = rv && |,{ lv_p1 }|.

    lv_p2 = '-1.5'.
    rv = rv && | g:{ generic( lv_p2 ) }|.
    CLEAR lv_p2.
    rv = rv && |,{ generic( lv_p2 ) }|.
    lv_p0 = 42.
    rv = rv && |,{ generic( lv_p0 ) }|.
    ASSIGN lv_p2 TO <lv_any>.
    <lv_any> = '3.14159'.
    rv = rv && |,{ lv_p2 }|.
    GET REFERENCE OF lv_p3 INTO lv_ref.
    ASSIGN lv_ref->* TO <lv_any>.
    <lv_any> = lv_p2.
    rv = rv && |,{ lv_p3 }|.
  ENDMETHOD.
ENDCLASS.
