CLASS zcl_osd_adt_logoff DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS valid_id
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_valid) TYPE abap_bool.
    CLASS-METHODS end_session
      IMPORTING iv_id TYPE string io_session TYPE REF TO zif_osd_adt_session.
ENDCLASS.

CLASS zcl_osd_adt_logoff IMPLEMENTATION.
  METHOD valid_id.
    rv_valid = boolc( strlen( iv_id ) = 24 AND iv_id CO `0123456789abcdef` ).
  ENDMETHOD.

  METHOD end_session.
*   Both the route and compatibility door use the serving session owner.
*   A foreign cookie must never end an arbitrary ENQ owner.
    IF valid_id( iv_id ) = abap_true.
      io_session->end( iv_id ).
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_route~handle.
    DATA lt_cookies TYPE tihttpnvp.
    DATA ls_cookie TYPE ihttpnvp.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA lv_name TYPE string.
    DATA lv_id TYPE string.
    lt_cookies = zcl_osd_adt_csrf=>cookies_of( is_request-headers ).
    LOOP AT lt_cookies INTO ls_cookie.
      IF ls_cookie-name = zif_osd_adt_session=>c_context_cookie.
        lv_id = ls_cookie-value.
      ENDIF.
    ENDLOOP.
    IF lv_id IS INITIAL.
      ls_identity = zcl_osd_adt_host=>identity( ).
      lv_name = `SAP_SESSIONID_` && ls_identity-system_id && `_` && ls_identity-client.
      LOOP AT lt_cookies INTO ls_cookie.
        IF ls_cookie-name = lv_name.
          lv_id = ls_cookie-value.
        ENDIF.
      ENDLOOP.
    ENDIF.
    end_session( iv_id = lv_id io_session = is_request-sessions ).
    rs_response-status = 200.
    rs_response-content_type = `text/plain; charset=utf-8`.
    rs_response-body = `logged off`.
  ENDMETHOD.
ENDCLASS.
