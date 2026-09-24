CLASS zcl_gogen_t_pcmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pcmp IMPLEMENTATION.
  METHOD run.
    CONSTANTS lc_ts TYPE timestamp VALUE '20260912010000'.
    CONSTANTS lc_z TYPE timestamp VALUE '0012'.
    DATA lv_ts TYPE timestamp.
    DATA lv_i TYPE i.
    DATA lv_p2 TYPE p LENGTH 2 DECIMALS 0.
    lv_ts = '20260912010001'.
    rv = |c:{ lc_ts } z:{ lc_z } v:{ lv_ts }|.
    IF lv_ts > lc_ts. rv = rv && ` gt`. ENDIF.
    IF lc_ts < lv_ts. rv = rv && ` lt`. ENDIF.
    IF lc_ts = lc_ts. rv = rv && ` eq`. ENDIF.
    IF lv_ts <> lc_ts. rv = rv && ` ne`. ENDIF.
    lv_i = 12.
    IF lc_z = lv_i. rv = rv && ` zi`. ENDIF.
    IF lv_i < lc_ts. rv = rv && ` ilt`. ENDIF.
    lv_p2 = -5.
    IF lv_p2 < lv_i. rv = rv && ` neg`. ENDIF.
    CLEAR lv_ts.
    IF lv_ts < lc_ts. rv = rv && ` init`. ENDIF.
  ENDMETHOD.
ENDCLASS.
