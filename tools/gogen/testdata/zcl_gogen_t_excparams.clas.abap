CLASS zcl_gogen_t_excparams DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mv_seen TYPE string.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    METHODS by_reference EXPORTING ev_text TYPE string CHANGING cv_text TYPE string.
    METHODS by_value EXPORTING VALUE(ev_text) TYPE string CHANGING VALUE(cv_text) TYPE string.
    METHODS returns RETURNING VALUE(rv_text) TYPE string.
    METHODS nested CHANGING cv_text TYPE string RAISING cx_sy_zerodivide.
    METHODS cleanup_raise CHANGING cv_text TYPE string RAISING cx_sy_zerodivide.
    METHODS uncaught_loop CHANGING cv_text TYPE string RAISING cx_sy_zerodivide.
ENDCLASS.

CLASS zcl_gogen_t_excparams IMPLEMENTATION.
  METHOD by_reference.
    DATA lv_zero TYPE i.
    DATA lv_dummy TYPE i.
    cv_text = `ref`.
    ev_text = `out`.
    mv_seen = `attr`.
    lv_dummy = 1 / lv_zero.
  ENDMETHOD.

  METHOD by_value.
    DATA lv_zero TYPE i.
    DATA lv_dummy TYPE i.
    cv_text = `lost`.
    ev_text = `lost`.
    lv_dummy = 1 / lv_zero.
  ENDMETHOD.

  METHOD returns.
    DATA lv_zero TYPE i.
    DATA lv_dummy TYPE i.
    rv_text = `lost`.
    lv_dummy = 1 / lv_zero.
  ENDMETHOD.

  METHOD cleanup_raise.
    DATA lv_zero TYPE i.
    DATA lv_dummy TYPE i.
    TRY.
        DO 3 TIMES.
          cv_text = cv_text && `x`.
        ENDDO.
        lv_dummy = 1 / lv_zero.
      CLEANUP.
        mv_seen = cv_text.
    ENDTRY.
  ENDMETHOD.

  METHOD nested.
    cleanup_raise( CHANGING cv_text = cv_text ).
  ENDMETHOD.

  METHOD uncaught_loop.
    DATA lv_zero TYPE i.
    DATA lv_dummy TYPE i.
    DO 2 TIMES.
      cv_text = cv_text && `y`.
    ENDDO.
    lv_dummy = 1 / lv_zero.
  ENDMETHOD.

  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_excparams.
    DATA lv_ref TYPE string VALUE `before`.
    DATA lv_out TYPE string VALUE `before`.
    DATA lv_value TYPE string VALUE `before`.
    DATA lv_value_out TYPE string VALUE `before`.
    DATA lv_result TYPE string VALUE `before`.
    DATA lv_nested TYPE string VALUE `n`.
    DATA lv_uncaught TYPE string VALUE `u`.
    DATA lv_fm_out TYPE i VALUE 9.
    DATA lv_fm_change TYPE i VALUE 10.
    DATA lv_fm_text TYPE string VALUE `keep`.
    DATA lt_fm TYPE STANDARD TABLE OF zgogen_t_dbw WITH DEFAULT KEY.
    CREATE OBJECT lo.
    TRY.
        lo->by_reference( IMPORTING ev_text = lv_out CHANGING cv_text = lv_ref ).
      CATCH cx_sy_zerodivide.
    ENDTRY.
    TRY.
        lo->by_value( IMPORTING ev_text = lv_value_out CHANGING cv_text = lv_value ).
      CATCH cx_sy_zerodivide.
    ENDTRY.
    TRY.
        lv_result = lo->returns( ).
      CATCH cx_sy_zerodivide.
    ENDTRY.
    TRY.
        lo->nested( CHANGING cv_text = lv_nested ).
      CATCH cx_sy_zerodivide.
    ENDTRY.
    TRY.
        lo->uncaught_loop( CHANGING cv_text = lv_uncaught ).
      CATCH cx_sy_zerodivide.
    ENDTRY.
    CALL FUNCTION 'ZGOGEN_T_FM'
      EXPORTING iv_n = 4 iv_boom = 1
      IMPORTING ev_n = lv_fm_out ev_s = lv_fm_text
      TABLES ct_row = lt_fm
      CHANGING cv_n = lv_fm_change
      EXCEPTIONS boom = 4 OTHERS = 8.
    rv = |{ lv_ref }/{ lv_out }/{ lv_value }/{ lv_value_out }/{ lv_result }/{ lo->mv_seen }/{ lv_nested }/{ lv_uncaught }/{ sy-subrc }/{ lv_fm_out }/{ lv_fm_change }/{ lv_fm_text }/{ lines( lt_fm ) }|.
  ENDMETHOD.
ENDCLASS.
