CLASS zcl_osd_st05 DEFINITION PUBLIC CREATE PUBLIC.
* The SQL trace, in the shape of the transaction that shows one (backlog
* G.10). Turn it on, do something, read what the system ran.
*
* **The trace does not live in a table, and that is the interesting part.**
* Every statement of a transpiled system goes through one object with eleven
* methods, so the tracer sits there -- which means a trace row written to a
* table would trace itself. Worse, a row written inside an open LUW is lost
* when that LUW rolls back and changes the commit shape when it does not,
* and the commit shape is exactly what a trace is read for. A measurement
* that takes part in what it measures is not one. So the ring is held by the
* host and reached the way the AMDP tile reaches HANA: a destination.
*
* What it answers, and why these three:
*   LIST      the statements in order, because an N+1 is a difference in
*             COUNT and a reordered read is a difference in POSITION
*   SUMMARY   where the request went (per table) and what it did twice --
*             the second is the entry a response comparison cannot produce
*             at all, since the answer is right and the work was done n times
*   START / STOP / CLEAR
*
* Off until somebody asks: a server that traces before it was asked is a
* server that pays for it. Measured, the wrapper costs 0.02 us a call while
* idle (docs/backlog.md, G.10 wave two).
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
*   `clike` rather than `string`: the rows come out of a DDIC structure, so
*   four of the six columns are CHAR and one is STRG, and a parameter typed
*   `string` refuses the CHAR ones. Found by the syntax check rather than at
*   runtime, which is the whole reason the structure is typed at all.
    CLASS-METHODS esc
      IMPORTING iv_text        TYPE clike
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS page
      IMPORTING iv_body        TYPE string
                iv_on          TYPE string
                iv_held        TYPE string
                iv_dropped     TYPE string
                iv_error       TYPE string
      RETURNING VALUE(rv_html) TYPE string.
ENDCLASS.

CLASS zcl_osd_st05 IMPLEMENTATION.

  METHOD esc.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
  ENDMETHOD.

  METHOD page.
    DATA lv_state TYPE string.
    DATA lv_note  TYPE string.

    IF iv_on = 'X'.
      lv_state = `recording`.
    ELSE.
      lv_state = `off`.
    ENDIF.

*   A screen that shows part of what it holds and does not say so is lying
*   quietly, so the number it dropped is on the page rather than in a log.
    IF iv_dropped <> '0' AND iv_dropped IS NOT INITIAL.
      lv_note = | &middot; { esc( iv_dropped ) } dropped (the ring is bounded)|.
    ENDIF.

    rv_html = `<!doctype html><html><head><meta charset="utf-8">` &&
      `<title>SQL trace</title><style>` &&
      `body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f7f7f7;color:#222}` &&
      `header{background:#354a5f;color:#fff;padding:10px 16px}` &&
      `header a{color:#cfe2f3;text-decoration:none;margin-right:14px}` &&
      `main{padding:16px}` &&
      `table{border-collapse:collapse;width:100%;background:#fff}` &&
      `th,td{border:1px solid #ddd;padding:4px 7px;text-align:left;vertical-align:top}` &&
      `th{background:#eef1f4}` &&
      `td.n{text-align:right;font-variant-numeric:tabular-nums}` &&
      `td.sql{font-family:Menlo,Consolas,monospace;font-size:12px;word-break:break-all}` &&
      `.dim{color:#777}.err{color:#a00}` &&
      `</style></head><body><header><b>SQL trace</b> ` &&
      |<span class="dim">{ lv_state } &middot; { esc( iv_held ) } held{ lv_note }</span>| &&
      ` &nbsp; <a href="?cmd=START">start</a><a href="?cmd=STOP">stop</a>` &&
      `<a href="?cmd=CLEAR">clear</a><a href="?cmd=LIST">statements</a>` &&
      `<a href="?cmd=SUMMARY">summary</a></header><main>`.

    IF iv_error IS NOT INITIAL.
      rv_html = rv_html && |<p class="err">{ esc( iv_error ) }</p>|.
    ENDIF.

    rv_html = rv_html && iv_body && `</main></body></html>`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_command   TYPE string.
    DATA lv_on        TYPE string.
    DATA lv_held      TYPE string.
    DATA lv_dropped   TYPE string.
    DATA lv_ms        TYPE string.
    DATA lv_error     TYPE string.
    DATA lt_statement TYPE STANDARD TABLE OF zosd_sqltrace_s WITH DEFAULT KEY.
    DATA ls_statement TYPE zosd_sqltrace_s.
    DATA lv_rows      TYPE string.
    DATA lv_body      TYPE string.
    DATA lv_head      TYPE string.
    DATA lx_root      TYPE REF TO cx_root.

    lv_command = server->request->get_form_field( 'cmd' ).
    IF lv_command IS INITIAL.
      lv_command = 'SUMMARY'.
    ENDIF.
    TRANSLATE lv_command TO UPPER CASE.

    TRY.
        CALL FUNCTION 'ZOSD_SQL_TRACE' DESTINATION 'SQLTRACE'
          EXPORTING iv_command   = lv_command
                    iv_limit     = `200`
          IMPORTING ev_on        = lv_on
                    ev_held      = lv_held
                    ev_dropped   = lv_dropped
                    ev_ms        = lv_ms
                    ev_error     = lv_error
          TABLES    et_statement = lt_statement.
      CATCH cx_root INTO lx_root.
*       The same lesson as the AMDP tile: the ABAP here guards itself, so
*       the thing thrown has to be catchable and has to SAY why. An
*       exception with no message is a 500 that has learnt to answer 200.
        lv_error = lx_root->get_text( ).
    ENDTRY.

    IF lv_command = 'SUMMARY'.
      lv_head = `<tr><th>count</th><th>kind</th><th>table</th><th>ms</th><th>rows</th><th>statement</th></tr>`.
    ELSE.
      lv_head = `<tr><th>#</th><th>operation</th><th>table</th><th>ms</th><th>rows</th><th>statement</th></tr>`.
    ENDIF.

    LOOP AT lt_statement INTO ls_statement.
      lv_rows = lv_rows &&
        |<tr><td class="n">{ ls_statement-seq }</td>| &&
        |<td>{ esc( ls_statement-operation ) }</td>| &&
        |<td>{ esc( ls_statement-tabname ) }</td>| &&
        |<td class="n">{ esc( ls_statement-ms ) }</td>| &&
        |<td class="n">{ ls_statement-rowcount }</td>| &&
        |<td class="sql">{ esc( ls_statement-statement ) }</td></tr>|.
    ENDLOOP.

    IF lv_rows IS INITIAL.
      IF lv_on = 'X'.
        lv_body = `<p class="dim">Recording, and nothing has run yet. Use the system, then read this page again.</p>`.
      ELSE.
        lv_body = `<p class="dim">The trace is off. Press <b>start</b>, use the system, then come back.</p>`.
      ENDIF.
    ELSE.
      lv_body = |<table>{ lv_head }{ lv_rows }</table>|.
      IF lv_command = 'SUMMARY' AND lv_ms IS NOT INITIAL.
        lv_body = lv_body && |<p class="dim">{ esc( lv_ms ) } ms in { esc( lv_held ) } statements. | &&
          `A count is not a defect: a statement run twice may be two different reads. ` &&
          `What it is, is the only place an N+1 is visible at all, because the answer is right.</p>`.
      ENDIF.
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( iv_body    = lv_body
                                       iv_on      = lv_on
                                       iv_held    = lv_held
                                       iv_dropped = lv_dropped
                                       iv_error   = lv_error ) ).
  ENDMETHOD.

ENDCLASS.
