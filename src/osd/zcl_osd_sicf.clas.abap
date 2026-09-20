CLASS zcl_osd_sicf DEFINITION PUBLIC CREATE PUBLIC.
* The ICF service tree, in the shape of the transaction that shows one.
*
* This is the half of G.5 that was missing: the registry has been readable
* from ABAP since ZCL_OSD_ICF and writable since ZOSD_ICF_ORIGIN, and
* nothing but a test called either. A registry nobody can look at is a
* registry nobody can be wrong about.
*
* What it shows, and why these columns: the URL and the handler are the two
* things a route is; **the origin** is who last wrote the row, without which
* the disagreement rule (docs/registry-drift.md) is a guess; and **active**
* is the one field a person actually changes here, which is why it is the
* one thing this screen writes.
*
* Deactivating a node here is not cosmetic: the serving runtime mounts from
* these rows, so a node switched off stops answering at the next recycle.
* Measured on 2026-09-20 -- /sap/bc/zork/ went from 200 to 404 that way.
  PUBLIC SECTION.
    INTERFACES if_http_extension.

*   Switch a node on or off, and **say that a person did it**. Without the
*   origin row the next start reads the row as the object's own, replaces it
*   and the change is gone -- which is the whole content of the drift rule
*   and the reason this is one method rather than two statements at a call
*   site somebody will copy.
*
*   Public because a test reaches it: the interesting failure is what the
*   bookkeeping does, and checking that through HTTP would check the HTML.
    CLASS-METHODS set_active
      IMPORTING iv_name   TYPE icfservice-icf_name
                iv_parent TYPE icfservice-icfparguid
                iv_active TYPE icfservice-icfactive.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-METHODS esc
      IMPORTING iv_text        TYPE clike
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS page
      IMPORTING iv_body        TYPE string
                iv_note        TYPE string
      RETURNING VALUE(rv_html) TYPE string.

ENDCLASS.

CLASS zcl_osd_sicf IMPLEMENTATION.

  METHOD esc.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
  ENDMETHOD.

  METHOD set_active.
    DATA ls_origin TYPE zosd_icf_origin.
    DATA lv_hash   TYPE zosd_icf_origin-objhash.

    UPDATE icfservice SET icfactive = iv_active
      WHERE icf_name = iv_name AND icfparguid = iv_parent.

*   **The object's hash is kept and only the origin changes.** Blanking it
*   would leave "has the object changed since it was applied" with nothing
*   to compare, so the next start would read the object as changed, set this
*   edit aside and put the node back. That exact mistake was made by hand
*   while proving the mechanism worked, and the mechanism caught it.
    SELECT SINGLE objhash FROM zosd_icf_origin INTO lv_hash
      WHERE icf_name = iv_name AND icfparguid = iv_parent.
    DELETE FROM zosd_icf_origin WHERE icf_name = iv_name AND icfparguid = iv_parent.
    CLEAR ls_origin.
    ls_origin-icf_name   = iv_name.
    ls_origin-icfparguid = iv_parent.
    ls_origin-origin     = 'E'.
    ls_origin-objhash    = lv_hash.
    ls_origin-changed_at = |{ sy-datum }{ sy-uzeit }|.
    INSERT zosd_icf_origin FROM ls_origin.
  ENDMETHOD.

  METHOD page.
    rv_html = `<!doctype html><html><head><meta charset="utf-8">` &&
      `<title>ICF services</title><style>` &&
      `body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f7f7f7;color:#222}` &&
      `header{background:#354a5f;color:#fff;padding:10px 16px}` &&
      `header a{color:#cfe2f3;text-decoration:none;margin-right:14px}` &&
      `main{padding:16px}` &&
      `table{border-collapse:collapse;width:100%;background:#fff}` &&
      `th,td{border:1px solid #ddd;padding:4px 7px;text-align:left;vertical-align:top}` &&
      `th{background:#eef1f4}` &&
      `td.u{font-family:Menlo,Consolas,monospace;font-size:12px}` &&
      `.dim{color:#777}.off{color:#a00}.edited{color:#b26a00}` &&
      `</style></head><body><header><b>ICF services</b> ` &&
      |<span class="dim">{ esc( iv_note ) }</span>| &&
      ` &nbsp; <a href="?">refresh</a></header><main>` &&
      iv_body && `</main></body></html>`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lt_nodes  TYPE zcl_osd_icf=>tt_node.
    DATA ls_node   LIKE LINE OF lt_nodes.
    DATA lt_origin TYPE STANDARD TABLE OF zosd_icf_origin.
    DATA ls_origin LIKE LINE OF lt_origin.
    DATA lv_rows   TYPE string.
    DATA lv_note   TYPE string.
    DATA lv_name   TYPE icfservice-icf_name.
    DATA lv_parent TYPE icfservice-icfparguid.
    DATA lv_cmd    TYPE string.
    DATA lv_state  TYPE string.
    DATA lv_origin TYPE string.
    DATA lv_active TYPE string.
    DATA lv_count  TYPE i.
    DATA lv_method TYPE string.
    DATA lv_aside  TYPE i.

    lv_cmd    = server->request->get_form_field( 'cmd' ).
    lv_name   = server->request->get_form_field( 'name' ).
    lv_parent = server->request->get_form_field( 'parent' ).
    lv_method = server->request->get_header_field( '~request_method' ).

*   **A GET must not change anything, and this one did.** The first version
*   switched a node on or off from a query string: a link in a page, a
*   crawler, a prefetch or an <img src> could deactivate a service, and
*   there was no CSRF token and no authentication in front of it. Found by
*   an adversarial review of my own work, 2026-09-20, while it was live on
*   the deployment.
    IF lv_cmd = 'ON' OR lv_cmd = 'OFF'.
      IF lv_method <> 'POST'.
        lv_note = |switching a node is a POST, not a link: a GET that changes state is one a crawler can press|.
        lv_cmd = ''.
      ELSE.
*       **and the node has to exist.** `set_active` used to UPDATE nothing
*       and then INSERT an origin row regardless, so any name and parent
*       arriving in a form field became a row in ZOSD_ICF_ORIGIN -- rows
*       for nodes that were never there, which the next apply would then
*       have to explain.
        SELECT SINGLE icf_name FROM icfservice INTO lv_name
          WHERE icf_name = lv_name AND icfparguid = lv_parent.
        IF sy-subrc <> 0.
          lv_note = |no such node|.
          lv_cmd = ''.
        ENDIF.
      ENDIF.
    ENDIF.

    IF lv_cmd = 'ON' OR lv_cmd = 'OFF'.
      IF lv_cmd = 'ON'.
        set_active( iv_name = lv_name iv_parent = lv_parent iv_active = 'X' ).
        lv_note = |{ lv_name } switched on|.
      ELSE.
        set_active( iv_name = lv_name iv_parent = lv_parent iv_active = ' ' ).
        lv_note = |{ lv_name } switched off -- it stops answering at the next recycle|.
      ENDIF.
    ENDIF.

    lt_nodes = zcl_osd_icf=>nodes( ).
    SELECT * FROM zosd_icf_origin INTO TABLE lt_origin.
    SELECT COUNT( * ) FROM zosd_icf_aside INTO lv_aside.

    LOOP AT lt_nodes INTO ls_node.
      lv_count = lv_count + 1.
      CLEAR lv_origin.
      READ TABLE lt_origin INTO ls_origin
        WITH KEY icf_name = ls_node-icf_name icfparguid = ls_node-icfparguid.
      IF sy-subrc = 0 AND ls_origin-origin = 'E'.
        lv_origin = `<span class="edited">edited here</span>`.
      ELSEIF sy-subrc = 0.
        lv_origin = `<span class="dim">from its object</span>`.
      ELSE.
*       a row nothing is known about is the seeder's -- said on the screen
*       rather than left blank, because blank reads as "nobody knows" and
*       the rule does know
        lv_origin = `<span class="dim">from its object (unrecorded)</span>`.
      ENDIF.

      IF ls_node-icfactive = 'X'.
        lv_state  = `active`.
        lv_active = |<form method="post"><input type="hidden" name="cmd" value="OFF">| &&
                    |<input type="hidden" name="name" value="{ esc( ls_node-icf_name ) }">| &&
                    |<input type="hidden" name="parent" value="{ esc( ls_node-icfparguid ) }">| &&
                    |<button type="submit">switch off</button></form>|.
      ELSE.
        lv_state  = `<span class="off">inactive</span>`.
        lv_active = |<form method="post"><input type="hidden" name="cmd" value="ON">| &&
                    |<input type="hidden" name="name" value="{ esc( ls_node-icf_name ) }">| &&
                    |<input type="hidden" name="parent" value="{ esc( ls_node-icfparguid ) }">| &&
                    |<button type="submit">switch on</button></form>|.
      ENDIF.

      lv_rows = lv_rows &&
        |<tr><td class="u">{ esc( ls_node-url ) }</td>| &&
        |<td>{ esc( ls_node-icf_name ) }</td>| &&
        |<td>{ esc( ls_node-handler ) }</td>| &&
        |<td>{ esc( ls_node-icftyp ) }</td>| &&
        |<td>{ lv_state }</td>| &&
        |<td>{ lv_origin }</td>| &&
        |<td>{ lv_active }</td>| &&
        |<td class="dim">{ esc( ls_node-icf_docu ) }</td></tr>|.
    ENDLOOP.

    IF lv_note IS INITIAL.
      lv_note = |{ lv_count } nodes, { lv_aside } rows set aside|.
    ENDIF.

    server->response->set_status( code = 200 reason = 'OK' ).
    server->response->set_content_type( 'text/html; charset=utf-8' ).
    server->response->set_cdata( page(
      iv_note = lv_note
      iv_body = `<table><tr><th>URL</th><th>Node</th><th>Handler</th><th>Type</th>` &&
                `<th>State</th><th>Origin</th><th></th><th>Description</th></tr>` &&
                lv_rows && `</table>` ) ).
  ENDMETHOD.

ENDCLASS.
