"! The ICF end of the ADT facade in ABAP (ADR 0007): if_http_extension on
"! /sap/bc/adt on a system, cl_express_icf_shim on Node. It turns the
"! request into a ZIF_OSD_ADT_ROUTE=>TY_REQUEST, asks ZCL_OSD_ADT_ROUTER,
"! and writes the answer back -- the same split as zcl_osd_rfc_http and
"! zcl_osd_rfc_channel, so the router is tested without a listener.
"!
"! A refusal is caught here once: ZCX_OSD_ADT as its own status and
"! document, anything else as a 500 ExceptionInternalError in our
"! namespace, which is what the Node facade's answered( ) does.
"!
"! A request no ABAP row serves is answered 404 with the header
"! X-OSD-Served-By: HOST: the HOST verdict. On Node the front in
"! tools/adt-abap-front.mjs calls ANSWER itself and reads the verdict from
"! EV_SERVED_BY, keeps the session's cookies and token of this answer and
"! lets the Node facade serve the request after the step; on a system there
"! is no host behind it, and the 404 with its document is the honest answer.
"! A route may also end in a HOST verdict of its own, with a continuation
"! (ZIF_OSD_ADT_ROUTE=>TY_CONTINUATION) the host runs after the step.
"!
"! The session (slice 3): when a ZIF_OSD_ADT_SESSION is in use (IO_SESSION
"! of ANSWER, which the Node front passes per request; USE_SESSION for the
"! ICF path), requests under /sap/bc/adt resolve their session first; the
"! ZCL_OSD_ADT_CSRF runs before the router, and every answer carries the
"! session's token and cookies. A session that ended while its request
"! waited (ZCX_OSD_ADT=>SESSION_ENDED) is answered as the CSRF refusal,
"! which makes a client log on again (docs/adt-abap-port/slice-3-front.md).
"!
"! FENCE commits session work before dispatch and rolls back only when
"! dispatch raises. The surrounding step commits successful route work,
"! whatever its response status. ENQ locks at _SCOPE 1 are independent.
CLASS zcl_osd_adt_handler DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    CONSTANTS c_served_by TYPE string VALUE `x-osd-served-by`.

    "! the answer to one request, without a server: what the handler writes;
    "! with io_session, under that session and its CSRF gate
    CLASS-METHODS answer
      IMPORTING is_request   TYPE zif_osd_adt_route=>ty_request
                io_session   TYPE REF TO zif_osd_adt_session OPTIONAL
      EXPORTING es_response  TYPE zif_osd_adt_route=>ty_response
                ev_served_by TYPE string.

    "! Re-entry after host work. The host supplies the fresh dialog step.
    CLASS-METHODS resume
      IMPORTING iv_kind TYPE string
                iv_json TYPE string
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.

    "! The transaction boundary for route work. No route commits itself.
    "! Called once per request by the handler; never call it from inside a
    "! route, because the inner COMMIT would persist the outer route's work.
    CLASS-METHODS fence
      IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
                it_routes TYPE zcl_osd_adt_router=>tt_route OPTIONAL
      RETURNING VALUE(rs_result) TYPE zcl_osd_adt_router=>ty_result
      RAISING cx_root.

    "! the session every request of HANDLE_REQUEST resolves; none (the
    "! default) leaves the session and CSRF to the host in front
    CLASS-METHODS use_session
      IMPORTING io_session TYPE REF TO zif_osd_adt_session OPTIONAL.

    "! a route table in place of ZCL_OSD_ADT_ROUTER=>ROUTES, for a test; an
    "! initial table is the real one again
    CLASS-METHODS use_routes
      IMPORTING it_routes TYPE zcl_osd_adt_router=>tt_route OPTIONAL.
  PRIVATE SECTION.
    CLASS-DATA go_session TYPE REF TO zif_osd_adt_session.
    CLASS-DATA gt_routes TYPE zcl_osd_adt_router=>tt_route.
    CLASS-METHODS route
      IMPORTING is_request   TYPE zif_osd_adt_route=>ty_request
      EXPORTING es_response  TYPE zif_osd_adt_route=>ty_response
                ev_served_by TYPE string.
    CLASS-METHODS refusal
      IMPORTING ix_error           TYPE REF TO zcx_osd_adt
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
ENDCLASS.

CLASS zcl_osd_adt_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_headers TYPE tihttpnvp.
    DATA ls_header TYPE ihttpnvp.
    DATA lv_served_by TYPE string.

    ls_request-method = to_upper( server->request->get_header_field( '~request_method' ) ).
    ls_request-path = server->request->get_header_field( '~path' ).
    ls_request-uri = server->request->get_header_field( '~request_uri' ).
    server->request->get_form_fields_cs( CHANGING fields = ls_request-query ).
    server->request->get_header_fields( CHANGING fields = lt_headers ).
*   the pseudo fields (~path, ~request_method, ...) are the ICF's, not the
*   client's
    LOOP AT lt_headers INTO ls_header WHERE name NP '~*'.
      APPEND ls_header TO ls_request-headers.
    ENDLOOP.
    ls_request-body = server->request->get_data( ).

    answer( EXPORTING is_request   = ls_request
                      io_session   = go_session
            IMPORTING es_response  = ls_response
                      ev_served_by = lv_served_by ).

    LOOP AT ls_response-headers INTO ls_header.
      server->response->set_header_field( name  = ls_header-name
                                          value = ls_header-value ).
    ENDLOOP.
    IF lv_served_by = zcl_osd_adt_router=>c_host.
      server->response->set_header_field( name  = c_served_by
                                          value = zcl_osd_adt_router=>c_host ).
    ENDIF.
    IF ls_response-content_type IS NOT INITIAL.
      server->response->set_header_field( name  = 'content-type'
                                          value = ls_response-content_type ).
    ENDIF.
    server->response->set_cdata( ls_response-body ).
    server->response->set_status( code   = ls_response-status
                                  reason = '' ).
  ENDMETHOD.

  METHOD use_session.
    go_session = io_session.
  ENDMETHOD.

  METHOD use_routes.
    gt_routes = it_routes.
  ENDMETHOD.

  METHOD answer.
    DATA ls_session TYPE zif_osd_adt_session=>ty_session.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA lv_path TYPE string.
    DATA lt_cookies TYPE string_table.
    DATA lx_adt TYPE REF TO zcx_osd_adt.

    CLEAR: es_response, ev_served_by.
    ls_request = is_request.
    CLEAR ls_request-session.
    ls_request-sessions = io_session.
    lv_path = to_lower( is_request-path ).
    IF io_session IS NOT BOUND OR
        ( lv_path <> `/sap/bc/adt` AND lv_path NP `/sap/bc/adt/*` ).
      route( EXPORTING is_request   = ls_request
             IMPORTING es_response  = es_response
                       ev_served_by = ev_served_by ).
      RETURN.
    ENDIF.

*   the session first: its cookies and its token go on every answer, the
*   refusal included, as the Node middleware set them before its gate
    TRY.
        ls_session = io_session->resolve( it_cookies = zcl_osd_adt_csrf=>cookies_of( is_request-headers )
                                          it_headers = is_request-headers ).
        lt_cookies = io_session->cookies( ls_session ).
        zcl_osd_adt_csrf=>check_token( ls_session-token ).
      CATCH zcx_osd_adt INTO lx_adt.
*       the session's own refusal, SESSION_ENDED included: an ENQ context
*       that ended is not a session that ended (the session binds the next
*       context and keeps its token), so it is never the CSRF refusal here
        ev_served_by = zcl_osd_adt_router=>c_abap.
        es_response = refusal( lx_adt ).
        RETURN.
    ENDTRY.

    IF zcl_osd_adt_csrf=>admits( iv_method   = is_request-method
                                 it_headers  = is_request-headers
                                 iv_id       = ls_session-id
                                 io_session  = io_session ) = abap_false.
      ev_served_by = zcl_osd_adt_router=>c_abap.
      es_response = zcl_osd_adt_csrf=>refusal( ).
      zcl_osd_adt_csrf=>stamp( EXPORTING it_cookies  = lt_cookies
                                         iv_token    = zcl_osd_adt_csrf=>c_required
                               CHANGING  cs_response = es_response ).
*     a refused write keeps no session it opened
      IF ls_session-fresh = abap_true.
        io_session->end( ls_session-id ).
      ENDIF.
      RETURN.
    ENDIF.

    ls_request-session = ls_session.
    route( EXPORTING is_request   = ls_request
           IMPORTING es_response  = es_response
                     ev_served_by = ev_served_by ).
    zcl_osd_adt_csrf=>stamp( EXPORTING it_cookies  = lt_cookies
                                       iv_token    = ls_session-token
                             CHANGING  cs_response = es_response ).
*   A request that opened its session and asks nothing of it (no token, no
*   state, no write: a readiness probe, a plain GET) is answered with the
*   session as usual but keeps no row: the step ends it. The next request
*   that fetches a token or asks for state opens the one that stays.
    IF ls_session-fresh = abap_true AND ls_session-stateful = abap_false
        AND zcl_osd_adt_csrf=>fetching( is_request-headers ) = abap_false
        AND zcl_osd_adt_csrf=>unsafe( is_request-method ) = abap_false.
      io_session->end( ls_session-id ).
    ENDIF.
  ENDMETHOD.

  METHOD resume.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    DATA ls_route TYPE zcl_osd_adt_router=>ty_route.
    DATA li_route TYPE REF TO zif_osd_adt_resumable.
    DATA lx_adt TYPE REF TO zcx_osd_adt.
    DATA lx_root TYPE REF TO cx_root.
    DATA lv_text TYPE string.

    lt_routes = gt_routes.
    IF lt_routes IS INITIAL.
      lt_routes = zcl_osd_adt_router=>routes( ).
    ENDIF.
    COMMIT WORK.
    TRY.
        IF iv_kind IS NOT INITIAL.
          LOOP AT lt_routes INTO ls_route WHERE resume_kind = iv_kind.
            CREATE OBJECT li_route TYPE (ls_route-handler).
            rs_response = li_route->resume( iv_kind = iv_kind iv_json = iv_json ).
            RETURN.
          ENDLOOP.
        ENDIF.
        lv_text = |no ABAP continuation { iv_kind } is registered|.
        lx_adt = zcx_osd_adt=>internal( lv_text ).
        RAISE EXCEPTION lx_adt.
      CATCH zcx_osd_adt INTO lx_adt.
        ROLLBACK WORK.
        rs_response = refusal( lx_adt ).
      CATCH cx_root INTO lx_root.
        ROLLBACK WORK.
        lv_text = lx_root->get_text( ).
        lx_adt = zcx_osd_adt=>internal( lv_text ).
        rs_response = refusal( lx_adt ).
    ENDTRY.
  ENDMETHOD.

  METHOD fence.
    DATA lx_error TYPE REF TO cx_root.
    COMMIT WORK.
    TRY.
        rs_result = zcl_osd_adt_router=>dispatch( is_request = is_request it_routes = it_routes ).
      CATCH cx_root INTO lx_error.
        ROLLBACK WORK.
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.

  METHOD route.
    DATA ls_result TYPE zcl_osd_adt_router=>ty_result.
    DATA lx_adt TYPE REF TO zcx_osd_adt.
    DATA lx_root TYPE REF TO cx_root.
    DATA lv_text TYPE string.

    CLEAR: es_response, ev_served_by.
    TRY.
        ls_result = fence( is_request = is_request it_routes = gt_routes ).
        ev_served_by = ls_result-served_by.
        IF ls_result-response-continuation-kind IS NOT INITIAL.
*         the route's own HOST verdict: its answer and what follows it
          ev_served_by = zcl_osd_adt_router=>c_host.
          es_response = ls_result-response.
        ELSEIF ev_served_by = zcl_osd_adt_router=>c_host.
          lv_text = |{ is_request-method } { is_request-path } is not served by ABAP here|.
          lx_adt = zcx_osd_adt=>not_found( lv_text ).
          es_response = refusal( lx_adt ).
        ELSE.
          es_response = ls_result-response.
        ENDIF.
      CATCH zcx_osd_adt INTO lx_adt.
        ev_served_by = zcl_osd_adt_router=>c_abap.
        es_response = refusal( lx_adt ).
      CATCH cx_root INTO lx_root.
        ev_served_by = zcl_osd_adt_router=>c_abap.
        lv_text = lx_root->get_text( ).
        lx_adt = zcx_osd_adt=>internal( lv_text ).
        es_response = refusal( lx_adt ).
    ENDTRY.
  ENDMETHOD.

  METHOD refusal.
    rs_response-status = ix_error->status.
    rs_response-content_type = `application/xml; charset=utf-8`.
    rs_response-body = ix_error->document( ).
  ENDMETHOD.

ENDCLASS.
