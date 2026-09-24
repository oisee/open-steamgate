* RFC-enabled, in function group ZOSD_T_HTTPC. Reached over HTTP through the
* SOAP-RFC handler at /sap/bc/soap/rfc: a slow endpoint for the timeout probe
* (a bounded WAIT, at most 10 seconds) and an echo of the text the SOAP
* runtime decoded from the posted body (EV_HEX is its UTF-8, base64 on the
* wire).
FUNCTION z_osd_t_httpc_sleep
  IMPORTING
    VALUE(iv_seconds) TYPE i
    VALUE(iv_text) TYPE string OPTIONAL
  EXPORTING
    VALUE(ev_text) TYPE string
    VALUE(ev_hex) TYPE xstring.
  DATA lv_wait TYPE i.
  lv_wait = iv_seconds.
  IF lv_wait > 10.
    lv_wait = 10.
  ENDIF.
  IF lv_wait > 0.
    WAIT UP TO lv_wait SECONDS.
  ENDIF.
  ev_text = iv_text.
  ev_hex = cl_abap_codepage=>convert_to( iv_text ).
ENDFUNCTION.
