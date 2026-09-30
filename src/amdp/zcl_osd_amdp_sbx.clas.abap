CLASS zcl_osd_amdp_sbx DEFINITION PUBLIC CREATE PUBLIC.
* The AMDP sandbox (backlog G.8): a SQLScript body typed on a screen and run
* now, against the database ABAP actually runs on.
*
* Why this is worth a screen at all. In a real system an AMDP body is the one
* piece of code you cannot try: it lives inside a method, it is deployed when
* the class is activated, and there is nowhere to type a line of SQLScript and
* see what it does. Here there is.
*
* What it is not: an editor. It does not save, it does not belong to a class,
* and nothing a person types survives the call -- the body is deployed under a
* throwaway name and dropped again (tools/amdp-destination.mjs).
*
* The half that matters is the failure. HANA answers a body it dislikes with a
* message naming the line and the column, and that message is the only oracle
* for SQLScript we have or are likely to get: no parser of ours would know the
* dialect of the version in front of us. So the engine's words are passed
* through -- the position moved back into the person's own line numbering,
* because a sandbox that points at a line the person cannot see is worse than
* one that says nothing, and the untouched message kept beside it, because the
* moment we paraphrase the oracle we stop having one.
*
* No server, no sandbox: this needs a database that speaks SQLScript, so it
* answers honestly on a deployment that has none rather than pretending.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
*   'HDB' when a body typed here would actually run, 'none' when there is no
*   engine behind the destination. Read by the launchpad, so a tile that
*   cannot do anything is grey rather than disappointing.
    CLASS-METHODS engine
      RETURNING
        VALUE(rv_engine) TYPE string.
    CLASS-METHODS rows_table
      IMPORTING iv_json TYPE string
      RETURNING VALUE(rv_html) TYPE string.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-DATA gv_engine TYPE string.
    CLASS-DATA gv_reason TYPE string.
    CONSTANTS c_example TYPE string VALUE
      'lt = SELECT 6*7 AS answer, CURRENT_DATE AS today FROM dummy;&&SELECT * FROM :lt;'.

    CLASS-METHODS page
      IMPORTING
        iv_body        TYPE string
        iv_result      TYPE string
        iv_error       TYPE string
        iv_raw         TYPE string
        iv_rows        TYPE string
        iv_ms          TYPE string
        iv_user        TYPE string
        iv_schema      TYPE string
        iv_restricted  TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS esc
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

*   The posted form, read out of the body rather than through
*   `get_form_field`. On a system ICF fills the form fields from an
*   `application/x-www-form-urlencoded` body as well as from the query string;
*   `cl_express_icf_shim` fills them **only** from the query string, so a
*   POSTed field is simply not there and reads as empty -- which looks exactly
*   like a person having submitted an empty box. Recorded in ANORMALIES.md;
*   until the shim is fixed the body is parsed here.
    CLASS-METHODS posted_body
      IMPORTING
        iv_raw         TYPE string
      RETURNING
        VALUE(rv_body) TYPE string.
ENDCLASS.

CLASS zcl_osd_amdp_sbx IMPLEMENTATION.

  METHOD esc.
    rv_text = cl_gui_control=>escape_html( iv_text ).
  ENDMETHOD.

  METHOD posted_body.
    DATA lt_pairs TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_pair  TYPE string.
    DATA lv_name  TYPE string.
    DATA lv_value TYPE string.

    SPLIT iv_raw AT '&' INTO TABLE lt_pairs.
    LOOP AT lt_pairs INTO lv_pair.
      SPLIT lv_pair AT '=' INTO lv_name lv_value.
      IF lv_name = 'body'.
*       A form posts a space as '+', which decoding percent-escapes does not
*       undo. The replacement is written in backticks on purpose: a text
*       literal in single quotes loses its trailing blanks, so WITH ' ' is
*       WITH '' and every space in the body silently disappears -- which
*       reads, on the screen, as a person having typed no spaces.
        REPLACE ALL OCCURRENCES OF '+' IN lv_value WITH ` `.
        rv_body = cl_http_utility=>unescape_url( lv_value ).
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD engine.
*   Can anything here run SQLScript at all? Asked by running the smallest
*   possible body, because that is the only honest answer: a name in a
*   configuration says what somebody intended, and this says what happens.
*   The answer is cached for the life of the process -- a launchpad asking on
*   every load would otherwise open a database connection per page view.
    DATA lv_error  TYPE string.
    DATA lv_result TYPE string.
    DATA lv_rows   TYPE string.
    DATA lv_ms     TYPE string.
    DATA lv_raw    TYPE string.
    DATA lx_root   TYPE REF TO cx_root.

    IF gv_engine IS NOT INITIAL.
      rv_engine = gv_engine.
      RETURN.
    ENDIF.

    TRY.
        CALL FUNCTION 'ZOSD_AMDP_SANDBOX' DESTINATION 'AMDP'
          EXPORTING iv_body   = `SELECT CURRENT_SCHEMA AS s FROM dummy;`
          IMPORTING ev_result = lv_result
                    ev_error  = lv_error
                    ev_raw    = lv_raw
                    ev_rows   = lv_rows
                    ev_ms     = lv_ms.
      CATCH cx_root INTO lx_root.
        lv_error = lx_root->get_text( ).
    ENDTRY.

    IF lv_error IS INITIAL AND lv_rows IS NOT INITIAL.
      gv_engine = 'HDB'.
    ELSE.
      gv_engine = 'none'.
      gv_reason = lv_error.
    ENDIF.
    rv_engine = gv_engine.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_body   TYPE string.
    DATA lv_result TYPE string.
    DATA lv_error  TYPE string.
    DATA lv_raw    TYPE string.
    DATA lv_rows   TYPE string.
    DATA lv_ms     TYPE string.
    DATA lv_user   TYPE string.
    DATA lv_schema TYPE string.
    DATA lv_restr  TYPE string.
    DATA lv_path   TYPE string.
    DATA lx_root   TYPE REF TO cx_root.
    DATA: BEGIN OF ls_cell,
            status    TYPE string,
            result    TYPE string,
            error     TYPE string,
            raw       TYPE string,
            rows      TYPE string,
            ms        TYPE string,
            system_db TYPE string,
          END OF ls_cell.

*   /engine: the one question a caller outside this page asks -- can anything
*   here run SQLScript? The launchpad greys its tile on the answer.
    lv_path = server->request->get_header_field( '~path_info' ).
    REPLACE ALL OCCURRENCES OF '/' IN lv_path WITH ''.
    CONDENSE lv_path.
    TRANSLATE lv_path TO LOWER CASE.
    IF lv_path = 'engine'.
      server->response->set_header_field( name = 'content-type' value = 'application/json' ).
      server->response->set_cdata( |\{"engine":"{ engine( ) }","destination":"AMDP","system_db":"{ sy-dbsys }"\}| ).
      RETURN.
    ENDIF.

*   Notebook SQLScript cells use this same sandbox destination and result,
*   without scraping the human-facing page. Refuse another database engine
*   first: a configured HANA destination must not make a SQLite system look
*   as though its own database ran the cell.
    IF lv_path = 'cell'.
      CLEAR ls_cell.
      ls_cell-system_db = sy-dbsys.
      server->response->set_header_field( name = 'content-type' value = 'application/json; charset=utf-8' ).
      IF sy-dbsys <> 'HDB'.
        ls_cell-status = 'error'.
        ls_cell-error = |SQLScript notebook cells require a HANA system database; this system uses { sy-dbsys }.|.
      ELSEIF server->request->get_header_field( '~request_method' ) <> 'POST'.
        ls_cell-status = 'error'.
        ls_cell-error = 'SQLScript notebook cells must be sent with POST'.
      ELSE.
        lv_body = server->request->get_cdata( ).
        TRY.
            CALL FUNCTION 'ZOSD_AMDP_SANDBOX' DESTINATION 'AMDP'
              EXPORTING iv_body   = lv_body
              IMPORTING ev_result = lv_result
                        ev_error  = lv_error
                        ev_raw    = lv_raw
                        ev_rows   = lv_rows
                        ev_ms     = lv_ms.
          CATCH cx_root INTO lx_root.
            lv_error = lx_root->get_text( ).
        ENDTRY.
        ls_cell-result = lv_result.
        ls_cell-error = lv_error.
        ls_cell-raw = lv_raw.
        ls_cell-rows = lv_rows.
        ls_cell-ms = lv_ms.
        IF lv_error IS INITIAL.
          ls_cell-status = 'ok'.
        ELSE.
          ls_cell-status = 'error'.
        ENDIF.
      ENDIF.
      server->response->set_cdata( /ui2/cl_json=>serialize(
        data = ls_cell
        pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
      RETURN.
    ENDIF.

    IF server->request->get_header_field( '~request_method' ) = 'POST'.
      lv_body = posted_body( server->request->get_cdata( ) ).
    ELSE.
      lv_body = c_example.
      REPLACE ALL OCCURRENCES OF '&&' IN lv_body WITH cl_abap_char_utilities=>newline.
    ENDIF.

    IF server->request->get_header_field( '~request_method' ) = 'POST'.
      TRY.
          CALL FUNCTION 'ZOSD_AMDP_SANDBOX' DESTINATION 'AMDP'
            EXPORTING iv_body   = lv_body
            IMPORTING ev_result = lv_result
                      ev_error  = lv_error
                      ev_raw    = lv_raw
                      ev_rows   = lv_rows
                      ev_ms     = lv_ms
                      ev_user   = lv_user
                      ev_schema = lv_schema
                      ev_restricted = lv_restr.
        CATCH cx_root INTO lx_root.
*         no HANA behind this deployment, or the connection is down. Say which
*         rather than showing an empty result table, which reads as "it ran and
*         found nothing"
          lv_error = lx_root->get_text( ).
      ENDTRY.
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( iv_body   = lv_body
                                       iv_result = lv_result
                                       iv_error  = lv_error
                                       iv_raw    = lv_raw
                                       iv_rows   = lv_rows
                                       iv_ms     = lv_ms
                                       iv_user   = lv_user
                                       iv_schema = lv_schema
                                       iv_restricted = lv_restr ) ).
  ENDMETHOD.

  METHOD rows_table.
*   The answer as the engine gave it, rendered without pretending to know the
*   shape: the columns are whatever came back. Reading it as text rather than
*   as a typed structure is the point -- a sandbox that only shows shapes it
*   was taught about is not a sandbox.
    DATA lt_rows   TYPE string_table.
    DATA lv_row    TYPE string.
    DATA lt_cells  TYPE tihttpnvp.
    DATA ls_cell   TYPE ihttpnvp.
    DATA lv_cells  TYPE string.
    DATA lv_head   TYPE string.
    DATA lv_first  TYPE abap_bool.
    DATA lx_error TYPE REF TO zcx_stg_error.

    IF iv_json IS INITIAL OR iv_json = '[]'.
      RETURN.
    ENDIF.

    TRY.
        lt_rows = zcl_stg_json=>parse_array( iv_json ).
      CATCH zcx_stg_error INTO lx_error.
        RETURN.
    ENDTRY.

    lv_first = abap_true.
    LOOP AT lt_rows INTO lv_row.
      TRY.
          lt_cells = zcl_stg_json=>parse_object( lv_row ).
        CATCH zcx_stg_error INTO lx_error.
          RETURN.
      ENDTRY.
      CLEAR lv_cells.
      CLEAR lv_head.
      LOOP AT lt_cells INTO ls_cell.
        lv_cells = |{ lv_cells }<td>{ esc( ls_cell-value ) }</td>|.
        lv_head  = |{ lv_head }<th>{ esc( ls_cell-name ) }</th>|.
      ENDLOOP.
      IF lv_first = abap_true.
        rv_html = |<table class="rows"><tr>{ lv_head }</tr>|.
        lv_first = abap_false.
      ENDIF.
      rv_html = |{ rv_html }<tr>{ lv_cells }</tr>|.
    ENDLOOP.
    IF rv_html IS NOT INITIAL.
      rv_html = |{ rv_html }</table>|.
    ENDIF.
  ENDMETHOD.

  METHOD page.
    DATA lv_answer TYPE string.
    DATA lv_where  TYPE string.
    DATA lv_who    TYPE string.

*   Where this went, said on the page rather than in a document: the sandbox
*   computes through a destination with a connection of its own, and the
*   system database of the same deployment is usually a different engine
*   entirely. Correct, and invisible -- which is how a person ends up asking
*   whether it really ran where they think.
    IF iv_user IS NOT INITIAL.
      IF iv_restricted IS INITIAL.
        lv_who = |<b>{ esc( iv_user ) }</b>, the privileged user| &&
                 ` (OSD_AMDP_SUPERUSER=1)`.
      ELSE.
        lv_who = |<b>{ esc( iv_user ) }</b>, a user with no grant outside its own schema|.
      ENDIF.
      lv_where = |<div class="where">Run through <b>DESTINATION 'AMDP'</b> as { lv_who }, | &&
                 |in schema <b>{ esc( iv_schema ) }</b>. | &&
                 |The system database of this deployment is <b>{ esc( CONV string( sy-dbsys ) ) }</b> -- | &&
                 `a body typed here does not touch it.</div>`.
    ENDIF.

    IF iv_error IS NOT INITIAL.
*     the engine's position, moved into the person's own numbering, and its
*     untouched words underneath
      lv_answer = |<div class="err"><b>the engine refused it</b><div class="msg">{ esc( iv_error ) }</div>|.
      IF iv_raw IS NOT INITIAL AND iv_raw <> iv_error.
        lv_answer = |{ lv_answer }<details><summary>what it said before the lines were renumbered</summary>| &&
                    |<div class="msg raw">{ esc( iv_raw ) }</div></details>|.
      ENDIF.
      lv_answer = |{ lv_answer }</div>|.
    ELSEIF iv_rows IS NOT INITIAL.
      lv_answer = |<div class="ok">{ esc( iv_rows ) } row(s), { esc( iv_ms ) } ms</div>| &&
                  rows_table( iv_result ).
    ENDIF.

    rv_html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">` &&
      `<title>AMDP sandbox</title><link rel="icon" href="/app/osg.svg">` &&
      `<style>` &&
      `body{margin:0;font:13px "72","Segoe UI",Arial,sans-serif;color:#1c2f43;background:#eef3f9}` &&
      `.hd{padding:10px 16px;background:linear-gradient(#ffffff,#dfe8f2);border-bottom:1px solid #b9c6d6}` &&
      `.hd b{font-size:15px}.hd span{color:#5d7186;margin-left:8px}` &&
      `.pane{padding:16px;max-width:900px}` &&
      `textarea{width:100%;height:220px;box-sizing:border-box;font:13px "Courier New",monospace;` &&
      `border:1px solid #b9c6d6;border-radius:2px;padding:8px;background:#fff;color:#1c2f43}` &&
      `.btn{margin-top:8px;padding:5px 14px;border:1px solid #b9c6d6;border-radius:2px;` &&
      `background:linear-gradient(#ffffff,#dfe8f2);cursor:pointer;font:13px "72","Segoe UI",Arial,sans-serif}` &&
      `.btn:hover{background:linear-gradient(#ffffff,#cbd8e6)}` &&
      `.ok{margin:12px 0 6px;color:#1a7a3c}` &&
      `.err{margin:12px 0;padding:10px;border:1px solid #d8a0a0;border-left:4px solid #b03030;background:#fdf3f3}` &&
      `.msg{font:12px "Courier New",monospace;margin-top:6px;white-space:pre-wrap}` &&
      `.msg.raw{color:#5d7186}` &&
      `table.rows{border-collapse:collapse;background:#fff;margin-top:4px}` &&
      `table.rows th,table.rows td{border:1px solid #b9c6d6;padding:3px 8px;text-align:left}` &&
      `table.rows th{background:#dbe7f4}` &&
      `.note{color:#5d7186;margin-top:18px;line-height:1.5}` &&
      `.where{margin-top:16px;padding:8px 10px;background:#f2f7fc;border-left:3px solid #b9c6d6;line-height:1.5}` &&
      `</style></head><body>` &&
      `<div class="hd"><b>AMDP sandbox</b>` &&
      `<span>SQLScript, run where the ABAP runs</span></div>` &&
      `<div class="pane"><form method="post" action="">` &&
      |<textarea name="body" spellcheck="false">{ esc( iv_body ) }</textarea>| &&
      `<div><button class="btn" type="submit">Run</button></div></form>` &&
      lv_answer &&
      lv_where &&
      `<div class="note">The body is deployed under a throwaway name, called, and dropped again: ` &&
      `nothing typed here survives the call, and nothing here is saved anywhere. ` &&
      `A body the engine refuses is answered with the engine's own message, ` &&
      `because its line and column are the only account of this dialect we have.</div>` &&
      `</div></body></html>`.
  ENDMETHOD.

ENDCLASS.
