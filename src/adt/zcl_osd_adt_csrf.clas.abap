"! The CSRF rules of the ADT facade (ADR 0007, slice 3), the handler's
"! half of the session (ZIF_OSD_ADT_SESSION is the other half). Node said
"! them in the session middleware of tools/adt-session.mjs; here they are
"! said once, without a server, so ABAP Unit reaches every branch:
"!   - every answer under /sap/bc/adt carries x-csrf-token = the session's
"!     token, never the word fetch: a client that reads fetch, or nothing,
"!     in that header concludes it is not logged on;
"!   - x-csrf-token: fetch asks for it, and is answered by that same header;
"!     it is no token, so on a write it is refused like any wrong one;
"!   - POST, PUT, DELETE, PATCH and MERGE whose header is not the session's
"!     token are refused: 403 text/plain "CSRF token validation failed"
"!     with x-csrf-token: Required, the one place that word appears.
"! The token itself, and whether it is the session's, are the session's
"! (RESOLVE, TOKEN_VALID).
CLASS zcl_osd_adt_csrf DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_header TYPE string VALUE `x-csrf-token`.
    CONSTANTS c_fetch TYPE string VALUE `fetch`.
    CONSTANTS c_required TYPE string VALUE `Required`.
    CONSTANTS c_failed TYPE string VALUE `CSRF token validation failed`.
    CONSTANTS c_set_cookie TYPE string VALUE `set-cookie`.

    "! a header's value, the name compared without case; initial when absent
    CLASS-METHODS header
      IMPORTING it_headers      TYPE tihttpnvp
                iv_name         TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    "! the methods the gate covers
    CLASS-METHODS unsafe
      IMPORTING iv_method        TYPE string
      RETURNING VALUE(rv_unsafe) TYPE abap_bool.

    "! does the request ask for a token (x-csrf-token: fetch, any case)
    CLASS-METHODS fetching
      IMPORTING it_headers         TYPE tihttpnvp
      RETURNING VALUE(rv_fetching) TYPE abap_bool.

    "! may the request pass: a safe method always; an unsafe one only with
    "! the session's own token, which the session says (TOKEN_VALID)
    CLASS-METHODS admits
      IMPORTING iv_method       TYPE string
                it_headers      TYPE tihttpnvp
                iv_id           TYPE string
                io_session      TYPE REF TO zif_osd_adt_session
      RETURNING VALUE(rv_admit) TYPE abap_bool.

    "! the refusal, byte for byte the Node middleware's refuseToken
    CLASS-METHODS refusal
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.

    "! the token a session answers is one a client can use: not empty and
    "! not the word fetch; raises an internal error otherwise
    CLASS-METHODS check_token
      IMPORTING iv_token TYPE string
      RAISING   zcx_osd_adt.

    "! the request's Cookie header as name/value pairs, as Node's
    "! parseCookies reads it: split at ';', a part without '=' dropped, the
    "! name and the value trimmed, an empty value kept
    CLASS-METHODS cookies_of
      IMPORTING it_headers        TYPE tihttpnvp
      RETURNING VALUE(rt_cookies) TYPE tihttpnvp.

    "! put the session onto an answer: the Set-Cookie lines first, then
    "! x-csrf-token = iv_token, replacing any the route wrote
    CLASS-METHODS stamp
      IMPORTING it_cookies  TYPE string_table
                iv_token    TYPE string
      CHANGING  cs_response TYPE zif_osd_adt_route=>ty_response.
ENDCLASS.

CLASS zcl_osd_adt_csrf IMPLEMENTATION.

  METHOD header.
    DATA ls_header TYPE ihttpnvp.
    DATA lv_name TYPE string.
    lv_name = to_lower( iv_name ).
    LOOP AT it_headers INTO ls_header.
      IF to_lower( ls_header-name ) = lv_name.
        rv_value = ls_header-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD unsafe.
    DATA lv_method TYPE string.
    lv_method = to_upper( iv_method ).
    rv_unsafe = boolc( lv_method = `POST` OR lv_method = `PUT` OR lv_method = `DELETE`
                    OR lv_method = `PATCH` OR lv_method = `MERGE` ).
  ENDMETHOD.

  METHOD fetching.
    rv_fetching = boolc( to_lower( header( it_headers = it_headers iv_name = c_header ) ) = c_fetch ).
  ENDMETHOD.

  METHOD admits.
    DATA lv_wanted TYPE string.
    IF unsafe( iv_method ) = abap_false.
      rv_admit = abap_true.
      RETURN.
    ENDIF.
    lv_wanted = header( it_headers = it_headers iv_name = c_header ).
*   no token and fetch are never a session's token: refused without asking
    IF lv_wanted IS INITIAL OR to_lower( lv_wanted ) = c_fetch OR io_session IS NOT BOUND.
      rv_admit = abap_false.
      RETURN.
    ENDIF.
    rv_admit = io_session->token_valid( iv_id = iv_id iv_token = lv_wanted ).
  ENDMETHOD.

  METHOD refusal.
    DATA ls_header TYPE ihttpnvp.
    rs_response-status = 403.
    rs_response-content_type = `text/plain; charset=utf-8`.
    rs_response-body = c_failed.
    ls_header-name = c_header.
    ls_header-value = c_required.
    APPEND ls_header TO rs_response-headers.
  ENDMETHOD.

  METHOD check_token.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    IF iv_token IS INITIAL OR to_lower( iv_token ) = c_fetch.
      lx_error = zcx_osd_adt=>internal( `the ADT session has no usable CSRF token` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
  ENDMETHOD.

  METHOD cookies_of.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA ls_cookie TYPE ihttpnvp.
    DATA lv_offset TYPE i.
    DATA lv_rest TYPE i.
    SPLIT header( it_headers = it_headers iv_name = `cookie` ) AT `;` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      FIND FIRST OCCURRENCE OF `=` IN lv_part MATCH OFFSET lv_offset.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      CLEAR ls_cookie.
      ls_cookie-name = lv_part(lv_offset).
      lv_offset = lv_offset + 1.
      lv_rest = strlen( lv_part ) - lv_offset.
      IF lv_rest > 0.
        ls_cookie-value = lv_part+lv_offset(lv_rest).
      ENDIF.
      REPLACE ALL OCCURRENCES OF REGEX `^\s+|\s+$` IN ls_cookie-name WITH ``.
      REPLACE ALL OCCURRENCES OF REGEX `^\s+|\s+$` IN ls_cookie-value WITH ``.
      APPEND ls_cookie TO rt_cookies.
    ENDLOOP.
  ENDMETHOD.

  METHOD stamp.
    DATA lt_headers TYPE tihttpnvp.
    DATA ls_header TYPE ihttpnvp.
    DATA lv_cookie TYPE string.
    LOOP AT it_cookies INTO lv_cookie.
      ls_header-name = c_set_cookie.
      ls_header-value = lv_cookie.
      APPEND ls_header TO lt_headers.
    ENDLOOP.
    LOOP AT cs_response-headers INTO ls_header.
      IF to_lower( ls_header-name ) <> c_header.
        APPEND ls_header TO lt_headers.
      ENDIF.
    ENDLOOP.
    ls_header-name = c_header.
    ls_header-value = iv_token.
    APPEND ls_header TO lt_headers.
    cs_response-headers = lt_headers.
  ENDMETHOD.

ENDCLASS.
