CLASS zcl_gogen_t_tryappend DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_tryappend IMPLEMENTATION.
  METHOD run.
    DATA lv_a TYPE string.
    DATA lv_n TYPE i.
    lv_a = `a`.
    TRY.
        DO 3 TIMES.
          lv_a = lv_a && `x`.
          IF sy-index = 2.
            lv_n = 1 / 0.
          ENDIF.
        ENDDO.
      CATCH cx_sy_zerodivide.
    ENDTRY.
    rv = lv_a.
  ENDMETHOD.
ENDCLASS.
