CLASS zcl_osd_adt_logoff DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS valid_id
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_valid) TYPE abap_bool.
ENDCLASS.

CLASS zcl_osd_adt_logoff IMPLEMENTATION.
  METHOD valid_id.
    rv_valid = boolc( strlen( iv_id ) = 24 AND iv_id CO `0123456789abcdef` ).
  ENDMETHOD.

  METHOD zif_osd_adt_route~handle.
    DATA lt_cookies TYPE tihttpnvp.
    DATA ls_cookie TYPE ihttpnvp.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA lv_name TYPE string.
    DATA lv_context TYPE string.
    DATA lv_session TYPE string.
    DATA lv_id TYPE string.
    ls_identity = zcl_osd_adt_host=>identity( ).
    lv_name = `SAP_SESSIONID_` && ls_identity-system_id && `_` && ls_identity-client.
    lt_cookies = zcl_osd_adt_csrf=>cookies_of( is_request-headers ).
    LOOP AT lt_cookies INTO ls_cookie.
      IF ls_cookie-name = zif_osd_adt_session=>c_context_cookie.
        lv_context = ls_cookie-value.
      ELSEIF ls_cookie-name = lv_name.
        lv_session = ls_cookie-value.
      ENDIF.
    ENDLOOP.
    lv_id = lv_context.
    IF lv_id IS INITIAL.
      lv_id = lv_session.
    ENDIF.
*   A foreign cookie must never end an arbitrary ENQ owner.
    IF valid_id( lv_id ) = abap_true.
      is_request-sessions->end( lv_id ).
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `text/plain; charset=utf-8`.
    rs_response-body = `logged off`.
  ENDMETHOD.
ENDCLASS.
