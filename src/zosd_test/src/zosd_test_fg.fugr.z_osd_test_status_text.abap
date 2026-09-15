FUNCTION z_osd_test_status_text.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_STATUS) TYPE  ZOSD_TEST_STATUS
*"  EXPORTING
*"     VALUE(EV_TEXT) TYPE  STRING
*"----------------------------------------------------------------------

  ev_text = zcl_zosd_test_demo=>status_text( iv_status ).

ENDFUNCTION.
