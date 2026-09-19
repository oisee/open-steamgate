CLASS zcl_osd_edit DEFINITION PUBLIC CREATE PUBLIC.
* The editor, on the screen (backlog G.8): pick an object, change its source,
* check it, activate it. In a browser, out of our own tree, with no Eclipse
* and no JavaScript.
*
* **It writes through the store, not beside it.** The backlog called "where
* does an edit land?" the first item of G.8's estimate. It had been answered
* on 2026-09-15 by the ADT facade and nobody wrote the answer back:
* `ObjectStore.write()` lands an object in the file it came from, in its own
* layer, as the two files abapGit would write, and marks it inactive until a
* check clears it. So this screen calls that -- `CALL FUNCTION 'ZOSD_STORE'
* DESTINATION 'STORE'` (tools/osd-store-destination.mjs) -- and an edit made
* here and an edit made from Eclipse are the same edit, in the same file,
* with the same activation behind them. A screen that wrote sources its own
* way would agree with Eclipse until the first day it did not.
*
* **Why a destination and not a door of its own**: the store is a Node object
* holding the tree, the abaplint registry and the build, and none of that
* exists inside the transpiled runtime. The AMDP tile reaches HANA this way
* and the ST05 screen reaches the trace ring this way. This is the third user
* of that seam rather than a third seam.
*
* **Check and Activate are two buttons on purpose.** Measured 2026-09-19 on a
* tree of 1518 objects: a check is a parse, about four seconds; an activation
* is the check over the object *and everyone who uses it*, and then a build,
* which is twelve seconds and never cached -- the build cache is keyed by
* content and an edit is new content by definition. One name over a cheap and
* an expensive operation is a button people stop pressing, so the screen has
* both and says what each costs.
*
* **No JavaScript**, like the rest of the webgui: a form, a textarea, and
* links. The screen's zero-script property is asserted by a test, and an
* editor is "state between requests plus a click", which is exactly what the
* webgui session already is.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CONSTANTS c_list_max TYPE string VALUE '300'.

    TYPES tt_object TYPE STANDARD TABLE OF zosd_object_s WITH DEFAULT KEY.
    TYPES tt_issue  TYPE STANDARD TABLE OF zosd_issue_s WITH DEFAULT KEY.
    TYPES tt_type   TYPE STANDARD TABLE OF zosd_type_s WITH DEFAULT KEY.
    TYPES tt_token  TYPE STANDARD TABLE OF zosd_token_s WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_answer,
             source   TYPE string,
             file     TYPE string,
             package  TYPE string,
             version  TYPE string,
             writable TYPE string,
             active   TYPE string,
             live     TYPE string,
             note     TYPE string,
             count    TYPE string,
             ms       TYPE string,
             error    TYPE string,
             objects  TYPE tt_object,
             issues   TYPE tt_issue,
             types    TYPE tt_type,
             tokens   TYPE tt_token,
           END OF ty_answer.

*   one call of the store, with everything the screen ever asks for
    CLASS-METHODS store
      IMPORTING
        iv_command       TYPE string
        iv_type          TYPE string OPTIONAL
        iv_name          TYPE string OPTIONAL
        iv_source        TYPE string OPTIONAL
        iv_filter        TYPE string OPTIONAL
        iv_limit         TYPE string OPTIONAL
      RETURNING
        VALUE(rs_answer) TYPE ty_answer.

    CLASS-METHODS object_list
      IMPORTING
        iv_filter      TYPE string
        iv_type        TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS editor
      IMPORTING
        iv_type        TYPE string
        iv_name        TYPE string
        iv_source      TYPE string
        is_answer      TYPE ty_answer
        iv_did         TYPE string
        iv_change      TYPE abap_bool
      RETURNING
        VALUE(rv_html) TYPE string.

*   the source with its keywords coloured, built from the tokens the PARSER
*   classified: a TokenNode is a keyword because the grammar matched it as
*   one, so `VALUE` is a keyword in a DATA statement and a name in a method
*   called `value`. No word list, and nothing to keep in step with ABAP.
*
*   It is display only -- the text area stays plain, because a caret cannot
*   be styled and an editor that fought the browser for it would be a worse
*   editor. Display and change, the pair the original had, and the colouring
*   is done where the parse already is (backlog G.8).
    CLASS-METHODS coloured
      IMPORTING
        iv_source      TYPE string
        it_token       TYPE tt_token
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS issue_table
      IMPORTING
        it_issue       TYPE tt_issue
        iv_active      TYPE string
        iv_ms          TYPE string
        iv_did         TYPE string
        iv_note        TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS page
      IMPORTING
        iv_body        TYPE string
        iv_title       TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

*   CLIKE and not STRING: half of what this screen escapes comes out of a
*   DDIC structure and is CHAR, and a STRING parameter refuses it
    CLASS-METHODS esc
      IMPORTING
        iv_text        TYPE clike
      RETURNING
        VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_edit IMPLEMENTATION.

  METHOD esc.
    rv_text = cl_gui_control=>escape_html( iv_text ).
  ENDMETHOD.

  METHOD store.
    DATA lx_root TYPE REF TO cx_root.

    TRY.
        CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
          EXPORTING iv_command  = iv_command
                    iv_type     = iv_type
                    iv_name     = iv_name
                    iv_include  = `main`
                    iv_source   = iv_source
                    iv_filter   = iv_filter
                    iv_limit    = iv_limit
          IMPORTING ev_source   = rs_answer-source
                    ev_file     = rs_answer-file
                    ev_package  = rs_answer-package
                    ev_version  = rs_answer-version
                    ev_writable = rs_answer-writable
                    ev_active   = rs_answer-active
                    ev_live     = rs_answer-live
                    ev_note     = rs_answer-note
                    ev_count    = rs_answer-count
                    ev_ms       = rs_answer-ms
                    ev_error    = rs_answer-error
          TABLES    et_object   = rs_answer-objects
                    et_issue    = rs_answer-issues
                    et_type     = rs_answer-types
                    et_token    = rs_answer-tokens.
      CATCH cx_root INTO lx_root.
*       The same rule as the AMDP tile and the trace screen: the ABAP guards
*       itself, and what is thrown has to SAY why. An exception with no
*       message is a 500 that has learnt to answer 200.
        rs_answer-error = lx_root->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_type   TYPE string.
    DATA lv_name   TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_source TYPE string.
    DATA lv_do     TYPE string.
    DATA lv_did    TYPE string.
    DATA lv_body   TYPE string.
    DATA lv_title  TYPE string.
    DATA ls_answer TYPE ty_answer.
    DATA lt_fields TYPE tihttpnvp.
    DATA lv_change TYPE abap_bool.
    DATA ls_tokens TYPE ty_answer.

*   read through zcl_osd_form, not through `get_form_field`: the shim fills
*   the form fields from the query string only, so the body of the POST this
*   screen's buttons send would be invisible (ANORMALIES, "a posted form has
*   no form fields"). On its first run every button answered the object
*   list, because the object's name was ''
    lt_fields = zcl_osd_form=>fields( server->request ).
    lv_type = zcl_osd_form=>value( it_fields = lt_fields iv_name = `type` ).
    lv_name = zcl_osd_form=>value( it_fields = lt_fields iv_name = `name` ).
    lv_filter = zcl_osd_form=>value( it_fields = lt_fields iv_name = `q` ).
    lv_source = zcl_osd_form=>value( it_fields = lt_fields iv_name = `src` ).
    lv_do = zcl_osd_form=>value( it_fields = lt_fields iv_name = `do` ).
    IF zcl_osd_form=>value( it_fields = lt_fields iv_name = `change` ) IS NOT INITIAL.
      lv_change = abap_true.
    ENDIF.
    TRANSLATE lv_type TO UPPER CASE.
    TRANSLATE lv_name TO UPPER CASE.
    TRANSLATE lv_filter TO UPPER CASE.

    IF lv_name IS INITIAL.
      lv_body = object_list( iv_filter = lv_filter iv_type = lv_type ).
      lv_title = `objects`.
    ELSE.
      lv_title = |{ lv_type } { lv_name }|.
      CASE lv_do.
        WHEN 'save'.
*         Save is a WRITE and nothing else. The check is a second click,
*         because it costs a parse of the whole system and a person who
*         wanted to keep what they typed did not ask for one.
          ls_answer = store( iv_command = `WRITE`
                             iv_type    = lv_type
                             iv_name    = lv_name
                             iv_source  = lv_source ).
          lv_did = `saved`.
        WHEN 'check'.
*         checked against what is in the BOX, not what is on disk: the point
*         of a check before a save is to answer about the text in front of
*         the person
          ls_answer = store( iv_command = `CHECK`
                             iv_type    = lv_type
                             iv_name    = lv_name
                             iv_source  = lv_source ).
          lv_did = `checked`.
        WHEN 'activate'.
*         the source is written first, because activating what is on disk
*         while the box holds something else is an activation of code nobody
*         is looking at
          ls_answer = store( iv_command = `WRITE`
                             iv_type    = lv_type
                             iv_name    = lv_name
                             iv_source  = lv_source ).
          IF ls_answer-error IS INITIAL.
            ls_answer = store( iv_command = `ACTIVATE`
                               iv_type    = lv_type
                               iv_name    = lv_name ).
          ENDIF.
          lv_did = `activated`.
        WHEN OTHERS.
          ls_answer = store( iv_command = `READ`
                             iv_type    = lv_type
                             iv_name    = lv_name ).
          lv_source = ls_answer-source.
      ENDCASE.
*     the tokens for the coloured display, and only when it is shown: the
*     parse costs seconds the first time and a text area does not need it
      IF lv_change = abap_false AND ls_answer-error IS INITIAL.
        ls_tokens = store( iv_command = `TOKENS`
                           iv_type    = lv_type
                           iv_name    = lv_name
                           iv_source  = lv_source ).
        ls_answer-tokens = ls_tokens-tokens.
      ENDIF.
*     after a write the box keeps what the person typed, not what a READ
*     would give back: the two are the same file, and a round trip that
*     silently replaced the text would hide a write that failed
      lv_body = editor( iv_type   = lv_type
                        iv_name   = lv_name
                        iv_source = lv_source
                        is_answer = ls_answer
                        iv_did    = lv_did
                        iv_change = lv_change ).
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( iv_body = lv_body iv_title = lv_title ) ).
  ENDMETHOD.

  METHOD object_list.
    DATA ls_answer TYPE ty_answer.
    DATA ls_object TYPE zosd_object_s.
    DATA ls_type   TYPE zosd_type_s.
    DATA lv_rows   TYPE string.
    DATA lv_tally  TYPE string.
    DATA lv_shown  TYPE string.

    ls_answer = store( iv_command = `LIST`
                       iv_type    = iv_type
                       iv_filter  = iv_filter
                       iv_limit   = c_list_max ).
    IF ls_answer-error IS NOT INITIAL.
      rv_html = |<div class="err"><b>The store did not answer.</b><div class="msg">{ esc( ls_answer-error ) }</div></div>|.
      RETURN.
    ENDIF.

    LOOP AT ls_answer-objects INTO ls_object.
      lv_rows = |{ lv_rows }<tr><td class="dim">{ esc( ls_object-type ) }</td>| &&
                |<td><a href="?type={ esc( ls_object-type ) }&amp;name={ esc( ls_object-name ) }">| &&
                |{ esc( ls_object-name ) }</a></td>| &&
                |<td class="dim">{ esc( ls_object-package ) }</td>| &&
                |<td class="dim">{ esc( ls_object-file ) }</td>| &&
                |<td class="dim">{ esc( ls_object-version ) }</td></tr>|.
    ENDLOOP.
    lv_shown = |{ lines( ls_answer-objects ) }|.

*   the tally of what the filter matched, before the type narrows it: the
*   list is cut at a limit and the types sort together, so six hundred
*   classes filled it and not one CDS view was visible. The screen said
*   "300 shown of 1140" and was honest; it was still not findable
    LOOP AT ls_answer-types INTO ls_type.
      lv_tally = |{ lv_tally }<a href="?type={ esc( ls_type-type ) }| &&
                 |{ COND string( WHEN iv_filter IS INITIAL THEN `` ELSE |&amp;q={ esc( iv_filter ) }| ) }">| &&
                 |{ esc( ls_type-type ) }</a> <span class="dim">{ ls_type-count }</span> |.
    ENDLOOP.

    rv_html =
      `<form class="sel" method="get" action="">` &&
      |<input type="text" name="q" value="{ esc( iv_filter ) }" placeholder="name contains" size="30">| &&
      |<input type="text" name="type" value="{ esc( iv_type ) }" placeholder="CLAS" size="6">| &&
      `<button type="submit">Find</button></form>` &&
*     the count is of what MATCHED and the list is what is shown: a list cut
*     at its limit that reported the cut length would say the system is
*     smaller than it is
      |<p class="note">{ esc( lv_shown ) } shown of { esc( ls_answer-count ) } objects. | &&
      `Every one of them is read from the tree this system was built from, ` &&
      `and a change here lands in the file the object came from -- the same ` &&
      `file Eclipse writes through the ADT facade.</p>` &&
      |<p class="tally">{ lv_tally }</p>| &&
      `<table class="rows"><tr><th>Type</th><th>Name</th><th>Package</th><th>File</th><th>Version</th></tr>` &&
      lv_rows && `</table>`.
  ENDMETHOD.

  METHOD editor.
    DATA lv_head  TYPE string.
    DATA lv_state TYPE string.
    DATA lv_box   TYPE string.

    IF is_answer-error IS NOT INITIAL.
      lv_head = |<div class="err"><b>The store refused.</b><div class="msg">{ esc( is_answer-error ) }</div></div>|.
    ENDIF.
    IF is_answer-writable = ''.
      lv_state = ` <span class="dim">read only</span>`.
    ENDIF.

*   Display and change, the pair the original had. In display the source is
*   coloured by the parser that is already in this process; in change it is
*   a plain text area, because a caret cannot be styled and an editor that
*   fought the browser over it would be a worse editor.
    IF iv_change = abap_false.
      lv_box = coloured( iv_source = iv_source it_token = is_answer-tokens ) &&
               |<div class="bar"><a class="btn" href="?type={ esc( iv_type ) }| &&
               |&amp;name={ esc( iv_name ) }&amp;change=x">Change</a>| &&
               |<span class="dim">coloured on the server, by the same parse the check runs on</span></div>|.
    ELSE.
      lv_box =
        `<form method="post" action="">` &&
        |<input type="hidden" name="type" value="{ esc( iv_type ) }">| &&
        |<input type="hidden" name="name" value="{ esc( iv_name ) }">| &&
        |<input type="hidden" name="change" value="x">| &&
        |<textarea name="src" rows="28" spellcheck="false">{ esc( iv_source ) }</textarea>| &&
        `<div class="bar">` &&
        `<button type="submit" name="do" value="check">Check</button>` &&
        `<button type="submit" name="do" value="save">Save</button>` &&
        `<button type="submit" name="do" value="activate">Activate</button>` &&
        `<span class="dim">Check is a parse of the system, seconds. ` &&
        `Activate is that check over every caller and then a build, and a build ` &&
        `of changed sources is never cached.</span>` &&
        `</div></form>`.
    ENDIF.

    rv_html = lv_head &&
      |<p class="note"><a href="?">objects</a> &middot; <code>{ esc( is_answer-file ) }</code>| &&
      |{ lv_state }</p>| &&
      lv_box &&
      issue_table( it_issue  = is_answer-issues
                   iv_active = is_answer-active
                   iv_ms     = is_answer-ms
                   iv_did    = iv_did
                   iv_note   = is_answer-note ).
  ENDMETHOD.

  METHOD coloured.
    DATA lt_lines TYPE string_table.
    DATA lv_line  TYPE string.
    DATA lv_no    TYPE i.
    DATA lv_at    TYPE i.
    DATA ls_token TYPE zosd_token_s.
    DATA lv_out   TYPE string.
    DATA lv_num   TYPE string.

    SPLIT iv_source AT |{ cl_abap_char_utilities=>newline }| INTO TABLE lt_lines.

    LOOP AT lt_lines INTO lv_line.
      lv_no = sy-tabix.
      lv_at = 1.
      CLEAR lv_out.
*     the tokens of this line, in order; everything between two of them is
*     written as it is, so the text always comes out whole even where the
*     parser understood nothing
      LOOP AT it_token INTO ls_token WHERE line = lv_no.
        IF ls_token-col > lv_at.
          lv_out = lv_out && esc( substring( val = lv_line
                                             off = lv_at - 1
                                             len = ls_token-col - lv_at ) ).
        ENDIF.
        IF ls_token-col - 1 + ls_token-len <= strlen( lv_line ).
          lv_out = lv_out && |<span class="t{ esc( ls_token-kind ) }">| &&
                   esc( substring( val = lv_line off = ls_token-col - 1 len = ls_token-len ) ) &&
                   `</span>`.
          lv_at = ls_token-col + ls_token-len.
        ENDIF.
      ENDLOOP.
      IF lv_at <= strlen( lv_line ).
        lv_out = lv_out && esc( substring( val = lv_line off = lv_at - 1 ) ).
      ENDIF.
      lv_num = |{ lv_no }|.
      rv_html = |{ rv_html }<span class="ln">{ lv_num }</span>{ lv_out }| &&
                cl_abap_char_utilities=>newline.
    ENDLOOP.

    rv_html = |<pre class="src">{ rv_html }</pre>|.
  ENDMETHOD.

  METHOD issue_table.
    DATA ls_issue TYPE zosd_issue_s.
    DATA lv_rows  TYPE string.

    IF iv_did IS INITIAL.
      RETURN.
    ENDIF.

    LOOP AT it_issue INTO ls_issue.
*     the object of the issue is named on the row, because an activation is
*     refused by a CALLER as often as by the object itself, and "it does not
*     compile" without a name is a sentence somebody spends an evening on
      lv_rows = |{ lv_rows }<tr><td class="dim">{ esc( ls_issue-obj_type ) } { esc( ls_issue-obj_name ) }</td>| &&
                |<td>{ ls_issue-line }</td><td>{ ls_issue-col }</td>| &&
                |<td class="dim">{ esc( ls_issue-rule ) }</td>| &&
                |<td>{ esc( ls_issue-message ) }</td></tr>|.
    ENDLOOP.

    IF lv_rows IS INITIAL.
      IF iv_did = `saved`.
        rv_html = |<p class="ok">Saved. Nothing was checked -- Check or Activate says whether it holds.</p>|.
      ELSE.
        rv_html = |<p class="ok">{ esc( iv_did ) }, and the system still compiles ({ esc( iv_ms ) } ms).</p>|.
      ENDIF.
*     what happened to the RUNNING system, which is a different question from
*     whether the code holds: an activation that reaches only the disk is
*     worth saying out loud rather than implying the better half of
      IF iv_note IS NOT INITIAL.
        rv_html = |{ rv_html }<p class="note">{ esc( iv_note ) }</p>|.
      ENDIF.
      RETURN.
    ENDIF.

    rv_html = |<p class="bad">{ esc( iv_did ) }: { lines( it_issue ) } issue(s) ({ esc( iv_ms ) } ms).| &&
              | Nothing is active while one of these stands.</p>| &&
              `<table class="rows"><tr><th>Object</th><th>Line</th><th>Col</th><th>Rule</th><th>Message</th></tr>` &&
              lv_rows && `</table>`.
  ENDMETHOD.

  METHOD page.
    DATA lv_title TYPE string.

    lv_title = `Editor`.
    IF iv_title IS NOT INITIAL.
      lv_title = |{ lv_title }: { iv_title }|.
    ENDIF.

    rv_html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">` &&
      |<title>{ esc( lv_title ) }</title><link rel="icon" href="/app/osg.svg">| &&
      `<style>` &&
      `body{margin:0;font:13px "72","Segoe UI",Arial,sans-serif;color:#1c2f43;background:#eef3f9}` &&
      `.hd{padding:10px 16px;background:linear-gradient(#ffffff,#dfe8f2);border-bottom:1px solid #b9c6d6}` &&
      `.hd b{font-size:15px}.hd span{color:#5d7186;margin-left:8px}` &&
      `.pane{padding:16px;overflow:auto}` &&
      `.note{color:#5d7186;line-height:1.5;margin:0 0 12px}` &&
      `.dim{color:#5d7186}` &&
      `a{color:#0a6ed1}` &&
      `.err{margin:12px 0;padding:10px;border:1px solid #d8a0a0;border-left:4px solid #b03030;background:#fdf3f3}` &&
      `.msg{font:12px "Courier New",monospace;margin-top:6px;white-space:pre-wrap}` &&
      `.ok{padding:8px 10px;border-left:4px solid #3c8c3c;background:#f2f9f2}` &&
      `.bad{padding:8px 10px;border-left:4px solid #b03030;background:#fdf3f3}` &&
      `textarea{width:100%;box-sizing:border-box;font:12px "Courier New",monospace;` &&
      `border:1px solid #b9c6d6;padding:8px;background:#fff;line-height:1.45}` &&
      `.bar{margin:8px 0 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}` &&
      `.tally{margin:0 0 10px;line-height:1.9;font:12px "Courier New",monospace}` &&
      `.tally a{text-decoration:none;font-weight:bold}` &&
      `button{font:13px "72","Segoe UI",Arial,sans-serif;padding:4px 12px;` &&
      `border:1px solid #b9c6d6;background:linear-gradient(#ffffff,#e6eef7);cursor:pointer}` &&
      `table.rows{border-collapse:collapse;background:#fff}` &&
      `table.rows th,table.rows td{border:1px solid #b9c6d6;padding:3px 8px;text-align:left;` &&
      `font:12px "Courier New",monospace}` &&
      `table.rows th{background:#dbe7f4;font:12px "72","Segoe UI",Arial,sans-serif}` &&
      `form.sel{margin:0 0 12px;display:flex;gap:6px}` &&
      `input[type=text]{font:12px "Courier New",monospace;padding:3px 6px;border:1px solid #b9c6d6}` &&
      `code{font:12px "Courier New",monospace;background:#e7eef7;padding:0 3px}` &&
      `pre.src{margin:0;padding:8px;background:#fff;border:1px solid #b9c6d6;overflow:auto;` &&
      `font:12px "Courier New",monospace;line-height:1.45}` &&
      `pre.src .ln{display:inline-block;width:3.5em;color:#a8b6c6;user-select:none}` &&
      `.tkeyword{color:#0a6ed1;font-weight:bold}.tcomment{color:#5c8a5c;font-style:italic}` &&
      `.tstring{color:#b03060}.tpragma{color:#8a6d3b}.tpunct{color:#8496a9}` &&
      `a.btn{display:inline-block;padding:4px 12px;border:1px solid #b9c6d6;` &&
      `background:linear-gradient(#ffffff,#e6eef7);text-decoration:none;color:#1c2f43}` &&
      `</style></head><body>` &&
      |<div class="hd"><b>Editor</b><span>{ esc( lv_title ) }</span></div>| &&
      |<div class="pane">{ iv_body }</div></body></html>|.
  ENDMETHOD.

ENDCLASS.
