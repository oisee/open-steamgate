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
  PROTECTED SECTION.
  PRIVATE SECTION.
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
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS rows_table
      IMPORTING
        iv_json        TYPE string
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

  METHOD if_http_extension~handle_request.
    DATA lv_body   TYPE string.
    DATA lv_result TYPE string.
    DATA lv_error  TYPE string.
    DATA lv_raw    TYPE string.
    DATA lv_rows   TYPE string.
    DATA lv_ms     TYPE string.
    DATA lx_root   TYPE REF TO cx_root.

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
                      ev_ms     = lv_ms.
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
                                       iv_ms     = lv_ms ) ).
  ENDMETHOD.

  METHOD rows_table.
*   The answer as the engine gave it, rendered without pretending to know the
*   shape: the columns are whatever came back. Reading it as text rather than
*   as a typed structure is the point -- a sandbox that only shows shapes it
*   was taught about is not a sandbox.
    DATA lt_rows   TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_row    TYPE string.
    DATA lv_inner  TYPE string.
    DATA lt_cells  TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_cell   TYPE string.
    DATA lv_cells  TYPE string.
    DATA lv_head   TYPE string.
    DATA lv_name   TYPE string.
    DATA lv_value  TYPE string.
    DATA lv_first  TYPE abap_bool.
    DATA lv_offset TYPE i.

    IF iv_json IS INITIAL OR iv_json = '[]'.
      RETURN.
    ENDIF.

    lv_inner = iv_json.
    REPLACE FIRST OCCURRENCE OF '[' IN lv_inner WITH ''.
*   the last bracket, not any bracket: a value may carry one
    lv_offset = strlen( lv_inner ) - 1.
    IF lv_offset >= 0 AND lv_inner+lv_offset(1) = ']'.
      lv_inner = lv_inner(lv_offset).
    ENDIF.
    SPLIT lv_inner AT '},' INTO TABLE lt_rows.

    lv_first = abap_true.
    LOOP AT lt_rows INTO lv_row.
      REPLACE ALL OCCURRENCES OF '{' IN lv_row WITH ''.
      REPLACE ALL OCCURRENCES OF '}' IN lv_row WITH ''.
      SPLIT lv_row AT ',"' INTO TABLE lt_cells.
      CLEAR lv_cells.
      CLEAR lv_head.
      LOOP AT lt_cells INTO lv_cell.
        SPLIT lv_cell AT ':' INTO lv_name lv_value.
        REPLACE ALL OCCURRENCES OF '"' IN lv_name WITH ''.
        REPLACE ALL OCCURRENCES OF '"' IN lv_value WITH ''.
        lv_cells = |{ lv_cells }<td>{ esc( lv_value ) }</td>|.
        lv_head  = |{ lv_head }<th>{ esc( lv_name ) }</th>|.
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
      `</style></head><body>` &&
      `<div class="hd"><b>AMDP sandbox</b>` &&
      `<span>SQLScript, run where the ABAP runs</span></div>` &&
      `<div class="pane"><form method="post" action="">` &&
      |<textarea name="body" spellcheck="false">{ esc( iv_body ) }</textarea>| &&
      `<div><button class="btn" type="submit">Run</button></div></form>` &&
      lv_answer &&
      `<div class="note">The body is deployed under a throwaway name, called, and dropped again: ` &&
      `nothing typed here survives the call, and nothing here is saved anywhere. ` &&
      `A body the engine refuses is answered with the engine's own message, ` &&
      `because its line and column are the only account of this dialect we have.</div>` &&
      `</div></body></html>`.
  ENDMETHOD.

ENDCLASS.
