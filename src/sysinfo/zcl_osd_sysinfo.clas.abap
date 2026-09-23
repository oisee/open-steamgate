* System information, two tabs: the system as sy shows it, and the
* environment -- what actually executes this ABAP.
*
* The environment is the host's to say, so ENVIRONMENT is a kernel method:
* on Node its @KERNEL lines describe the transpiler runtime, in the Go
* build (tools/gogen) the whole method is the host function
* abap.SysInfoEnv, and on a real system neither answers and the page says
* the SAP kernel runs it. One "name<TAB>value" line per fact.
CLASS zcl_osd_sysinfo DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    TYPES: BEGIN OF ty_row,
             name  TYPE string,
             value TYPE string,
           END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS environment RETURNING VALUE(rv_env) TYPE string.
    CLASS-METHODS system_rows RETURNING VALUE(rt_rows) TYPE ty_rows.
    CLASS-METHODS environment_rows RETURNING VALUE(rt_rows) TYPE ty_rows.
    CLASS-METHODS page RETURNING VALUE(rv_html) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS esc IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS rows_html IMPORTING it_rows TYPE ty_rows RETURNING VALUE(rv_html) TYPE string.
ENDCLASS.

CLASS zcl_osd_sysinfo IMPLEMENTATION.

  METHOD environment.
    WRITE '@KERNEL const P = typeof process === "undefined" ? undefined : process;'.
    WRITE '@KERNEL const L = ["runtime\tABAP transpiled to JavaScript (@abaplint/transpiler)"];'.
    WRITE '@KERNEL if (P && P.versions && P.versions.node) {'.
    WRITE '@KERNEL   L.push("node\t" + P.version, "platform\t" + P.platform + "/" + P.arch, "process\t" + P.pid);'.
    WRITE '@KERNEL   L.push("uptime\t" + Math.round(P.uptime()) + " s", "memory\t" + (P.memoryUsage().rss / 1048576).toFixed(1) + " MB resident");'.
    WRITE '@KERNEL } else if (typeof navigator !== "undefined") {'.
    WRITE '@KERNEL   L.push("browser\t" + navigator.userAgent);'.
    WRITE '@KERNEL }'.
    WRITE '@KERNEL rv_env.set(L.join("\n"));'.
  ENDMETHOD.

  METHOD system_rows.
    DATA ls_row TYPE ty_row.
    DATA lv_date TYPE string.
    DATA lv_time TYPE string.

    lv_date = sy-datum.
    lv_time = sy-uzeit.
    ls_row-name = 'System (sy-sysid)'.
    ls_row-value = sy-sysid.
    APPEND ls_row TO rt_rows.
    ls_row-name = 'Client (sy-mandt)'.
    ls_row-value = sy-mandt.
    APPEND ls_row TO rt_rows.
    ls_row-name = 'User (sy-uname)'.
    ls_row-value = sy-uname.
    APPEND ls_row TO rt_rows.
    ls_row-name = 'Date (sy-datum)'.
    ls_row-value = |{ substring( val = lv_date off = 0 len = 4 ) }-{ substring( val = lv_date off = 4 len = 2 ) }-{ substring( val = lv_date off = 6 len = 2 ) }|.
    APPEND ls_row TO rt_rows.
    ls_row-name = 'Time (sy-uzeit)'.
    ls_row-value = |{ substring( val = lv_time off = 0 len = 2 ) }:{ substring( val = lv_time off = 2 len = 2 ) }:{ substring( val = lv_time off = 4 len = 2 ) }|.
    APPEND ls_row TO rt_rows.
  ENDMETHOD.

  METHOD environment_rows.
    DATA lv_env TYPE string.
    DATA lt_lines TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_line TYPE string.
    DATA ls_row TYPE ty_row.

    lv_env = environment( ).
    IF lv_env IS INITIAL.
      ls_row-name = 'runtime'.
      ls_row-value = 'the SAP kernel (no host answered: this is a system)'.
      APPEND ls_row TO rt_rows.
      RETURN.
    ENDIF.
    SPLIT lv_env AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line.
      CLEAR ls_row.
      SPLIT lv_line AT cl_abap_char_utilities=>horizontal_tab INTO ls_row-name ls_row-value.
      APPEND ls_row TO rt_rows.
    ENDLOOP.
  ENDMETHOD.

  METHOD esc.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF '&' IN rv_text WITH '&amp;'.
    REPLACE ALL OCCURRENCES OF '<' IN rv_text WITH '&lt;'.
    REPLACE ALL OCCURRENCES OF '>' IN rv_text WITH '&gt;'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_text WITH '&quot;'.
  ENDMETHOD.

  METHOD rows_html.
    DATA ls_row TYPE ty_row.
    rv_html = `<table>`.
    LOOP AT it_rows INTO ls_row.
      rv_html = rv_html && `<tr><th>` && esc( ls_row-name ) && `</th><td>` && esc( ls_row-value ) && `</td></tr>`.
    ENDLOOP.
    rv_html = rv_html && `</table>`.
  ENDMETHOD.

  METHOD page.
    DATA lv_sid TYPE string.
    DATA lv_client TYPE string.
    DATA lv_runtime TYPE string.
    DATA lt_env TYPE ty_rows.
    DATA ls_row TYPE ty_row.

    lv_sid = sy-sysid.
    lv_client = sy-mandt.
    lt_env = environment_rows( ).
    READ TABLE lt_env INTO ls_row INDEX 1.
    lv_runtime = ls_row-value.

    rv_html = `<!doctype html><html><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width,initial-scale=1">` &&
      `<title>System information</title><style>` &&
      `body{margin:0;background:#f5f6f7;color:#32363a;font:14px/1.5 "72",Arial,Helvetica,sans-serif}` &&
      `main{max-width:760px;margin:0 auto;padding:20px 16px}` &&
      `h1{font-size:20px;margin:0}.sub{color:#6a6d70;margin:2px 0 16px}` &&
      `.runtime{display:inline-block;background:#e5f0fa;color:#0a6ed1;border-radius:4px;padding:2px 8px;font-weight:bold}` &&
      `input{position:absolute;opacity:0}` &&
      `label{display:inline-block;padding:8px 14px;cursor:pointer;color:#6a6d70;border-bottom:3px solid transparent}` &&
      `#tsys:checked+label,#tenv:checked+label{color:#0a6ed1;border-bottom-color:#0a6ed1}` &&
      `input:focus-visible+label{outline:2px dotted #0a6ed1}` &&
      `.tabs{border-bottom:1px solid #d9d9d9;margin-bottom:12px}` &&
      `section{display:none}#tsys:checked~#psys,#tenv:checked~#penv{display:block}` &&
      `table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e5e5}` &&
      `th,td{text-align:left;vertical-align:top;padding:8px 12px;border-top:1px solid #eee}` &&
      `th{width:34%;color:#6a6d70;font-weight:normal}td{word-break:break-word}` &&
      `</style></head><body><main><h1>System information</h1>` &&
      `<p class="sub">` && esc( lv_sid ) && `, client ` && esc( lv_client ) && ` &middot; <span class="runtime">` && esc( lv_runtime ) && `</span></p>` &&
      `<div class="tabs"></div>` &&
      `<input type="radio" name="tab" id="tsys"><label for="tsys">System</label>` &&
      `<input type="radio" name="tab" id="tenv" checked><label for="tenv">Environment</label>` &&
      `<section id="psys">` && rows_html( system_rows( ) ) && `</section>` &&
      `<section id="penv">` && rows_html( lt_env ) && `</section>` &&
      `</main></body></html>`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    server->response->set_header_field( name  = 'content-type'
                                        value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( ) ).
  ENDMETHOD.

ENDCLASS.
