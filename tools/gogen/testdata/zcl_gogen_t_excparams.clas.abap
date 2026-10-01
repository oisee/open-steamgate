CLASS zcl_gogen_t_excparams DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mv_seen TYPE string.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    METHODS by_reference EXPORTING ev_text TYPE string CHANGING cv_text TYPE string.
    METHODS by_value EXPORTING VALUE(ev_text) TYPE string CHANGING VALUE(cv_text) TYPE string.
    METHODS returns RETURNING VALUE(rv_text) TYPE string.
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

  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_excparams.
    DATA lv_ref TYPE string VALUE `before`.
    DATA lv_out TYPE string VALUE `before`.
    DATA lv_value TYPE string VALUE `before`.
    DATA lv_value_out TYPE string VALUE `before`.
    DATA lv_result TYPE string VALUE `before`.
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
    rv = |{ lv_ref }/{ lv_out }/{ lv_value }/{ lv_value_out }/{ lv_result }/{ lo->mv_seen }|.
  ENDMETHOD.
ENDCLASS.
