FUNCTION z_test_status_text.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_STATUS) TYPE  ZTEST_STATUS
*"  EXPORTING
*"     VALUE(EV_TEXT) TYPE  STRING
*"----------------------------------------------------------------------

  ev_text = zcl_ztest_demo=>status_text( iv_status ).

ENDFUNCTION.
