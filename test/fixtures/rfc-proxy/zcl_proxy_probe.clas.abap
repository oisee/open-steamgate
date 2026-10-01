CLASS zcl_proxy_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run_static
      IMPORTING iv_key TYPE c
      RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS run_dynamic
      IMPORTING iv_name TYPE string iv_key TYPE c
      RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_proxy_probe IMPLEMENTATION.
  METHOD run_static.
    DATA lv_text TYPE c LENGTH 20.
    CALL FUNCTION 'Z_PROXY_PROBE_FM'
      EXPORTING iv_key = iv_key
      IMPORTING ev_text = lv_text
      EXCEPTIONS not_found = 4 OTHERS = 8.
    rv_text = |{ sy-subrc }:{ lv_text }|.
  ENDMETHOD.

  METHOD run_dynamic.
    DATA lv_text TYPE c LENGTH 20.
    DATA lv_name TYPE string.
    lv_name = iv_name.
    CALL FUNCTION lv_name
      EXPORTING iv_key = iv_key
      IMPORTING ev_text = lv_text
      EXCEPTIONS not_found = 4 OTHERS = 8.
    rv_text = |{ sy-subrc }:{ lv_text }|.
  ENDMETHOD.
ENDCLASS.
