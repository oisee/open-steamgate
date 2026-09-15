CLASS zcl_ztest_demo DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES zif_ztest_greeter.

    METHODS constructor
      IMPORTING
        iv_prefix TYPE string DEFAULT 'Hello'.

    CLASS-METHODS status_text
      IMPORTING
        iv_status      TYPE ztest_status
      RETURNING
        VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    DATA mv_prefix TYPE string.

ENDCLASS.

CLASS zcl_ztest_demo IMPLEMENTATION.

  METHOD constructor.
    mv_prefix = iv_prefix.
  ENDMETHOD.

  METHOD zif_ztest_greeter~greet.
    DATA lv_name TYPE string.
    lv_name = iv_name.
    IF lv_name IS INITIAL.
      lv_name = zif_ztest_greeter=>co_unknown.
    ENDIF.
    CONCATENATE mv_prefix lv_name INTO rv_text SEPARATED BY space.
  ENDMETHOD.

  METHOD status_text.
    CASE iv_status.
      WHEN 'N'.
        rv_text = 'New'.
      WHEN 'O'.
        rv_text = 'Open'.
      WHEN 'C'.
        rv_text = 'Closed'.
      WHEN OTHERS.
        rv_text = zif_ztest_greeter=>co_unknown.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
