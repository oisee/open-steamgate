CLASS zcl_osd_se16 DEFINITION PUBLIC CREATE PUBLIC.
* A data browser, in the shape of the transaction everybody actually uses
* (backlog G.9). Pick a table, see its rows.
*
* What makes it cheap, and worth saying because it is the point: **no new
* access to data was written for it.** The generation already produces one
* class per DDIC table (tools/cds2ddic.mjs), every one of them implements
* `zif_stg_cds_source`, and `zcl_stg_cds_registry` already lists them. So
* this screen is a *page over reads the system already performs for its own
* OData* -- the same path, the same client, the same client column handling.
* If a row looks wrong here it is wrong everywhere.
*
* Which is also the reason it is not a spreadsheet: it reads through the
* application, not around it. A tool that went straight to the database
* would show rows the application cannot see, and then the interesting
* question -- why does the app not show this row -- would be unanswerable.
*
* Wave 1 is the list, the rows and a row limit. A filter and a column
* selection are what makes it SE16 rather than a listing, and they come next.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CONSTANTS c_default_max TYPE i VALUE 100.

    CLASS-METHODS entity_list
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS rows_of
      IMPORTING
        iv_name        TYPE string
        iv_max         TYPE i
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS page
      IMPORTING
        iv_body        TYPE string
        iv_title       TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS esc
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_se16 IMPLEMENTATION.

  METHOD esc.
    rv_text = cl_gui_control=>escape_html( iv_text ).
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_name TYPE string.
    DATA lv_max  TYPE i.
    DATA lv_body TYPE string.
    DATA lv_raw  TYPE string.

    lv_name = server->request->get_form_field( 't' ).
    TRANSLATE lv_name TO UPPER CASE.
    lv_raw = server->request->get_form_field( 'max' ).
    lv_max = c_default_max.
    IF lv_raw CO '0123456789' AND lv_raw IS NOT INITIAL.
      lv_max = lv_raw.
    ENDIF.

    IF lv_name IS INITIAL.
      lv_body = entity_list( ).
    ELSE.
      lv_body = rows_of( iv_name = lv_name iv_max = lv_max ).
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( iv_body = lv_body iv_title = lv_name ) ).
  ENDMETHOD.

  METHOD entity_list.
    DATA lt_entities TYPE zcl_stg_cds_registry=>tt_entity.
    DATA ls_entity   TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lv_rows     TYPE string.

    lt_entities = zcl_stg_cds_registry=>entities( ).
    SORT lt_entities BY name.
    LOOP AT lt_entities INTO ls_entity.
      lv_rows = |{ lv_rows }<tr><td><a href="?t={ esc( ls_entity-name ) }">{ esc( ls_entity-name ) }</a></td>| &&
                |<td class="dim">{ esc( ls_entity-label ) }</td>| &&
                |<td class="dim">{ esc( ls_entity-sql_view ) }</td>| &&
                |<td class="dim">{ lines( ls_entity-fields ) }</td></tr>|.
    ENDLOOP.

    rv_html = |<p class="note">{ lines( lt_entities ) } entities the system can read. | &&
              `Every one of them is read here through the same source class the OData services use ` &&
              `-- not around the application, through it.</p>` &&
              `<table class="rows"><tr><th>Name</th><th>Label</th><th>View</th><th>Fields</th></tr>` &&
              lv_rows && `</table>`.
  ENDMETHOD.

  METHOD rows_of.
    DATA ls_entity  TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lo_source  TYPE REF TO zif_stg_cds_source.
    DATA lr_data    TYPE REF TO data.
    DATA lt_orderby TYPE string_table.
    DATA ls_field   TYPE zcl_stg_cds_registry=>ty_field.
    DATA lv_head    TYPE string.
    DATA lv_rows    TYPE string.
    DATA lv_cells   TYPE string.
    DATA lv_count   TYPE i.
    DATA lv_shown   TYPE i.
    DATA lv_class   TYPE string.
    DATA lx_root    TYPE REF TO cx_root.
    FIELD-SYMBOLS <lt_table> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>   TYPE any.
    FIELD-SYMBOLS <lv_value> TYPE any.

    ls_entity = zcl_stg_cds_registry=>get( iv_name ).
    IF ls_entity-name IS INITIAL.
      rv_html = |<div class="err">No entity called <b>{ esc( iv_name ) }</b>. | &&
                `<a href="?">Back to the list</a></div>`.
      RETURN.
    ENDIF.

    TRY.
        lv_class = ls_entity-source_class.
        CREATE OBJECT lo_source TYPE (lv_class).
        lr_data = lo_source->read( iv_where   = ``
                                   it_orderby = lt_orderby ).
      CATCH cx_root INTO lx_root.
*       a source that cannot be created or cannot read says why, rather than
*       showing an empty table -- which reads as "there is nothing here"
        rv_html = |<div class="err"><b>{ esc( iv_name ) } could not be read</b>| &&
                  |<div class="msg">{ esc( lx_root->get_text( ) ) }</div></div>|.
        RETURN.
    ENDTRY.

    ASSIGN lr_data->* TO <lt_table>.
    IF <lt_table> IS NOT ASSIGNED.
      rv_html = |<div class="err">{ esc( iv_name ) } answered with nothing to read.</div>|.
      RETURN.
    ENDIF.

*   the columns are the entity's own fields, in its own order: the registry
*   knows them, so nothing has to be guessed from the first row -- and an
*   empty table still gets its headers, which is the difference between
*   "no rows" and "no table"
    LOOP AT ls_entity-fields INTO ls_field.
      lv_head = |{ lv_head }<th>{ esc( ls_field-name ) }</th>|.
    ENDLOOP.

    LOOP AT <lt_table> ASSIGNING <ls_row>.
      lv_count = lv_count + 1.
      IF lv_count > iv_max.
        EXIT.
      ENDIF.
*     counted separately from the loop index on purpose: `lv_count - 1` is
*     right only when the limit stopped the loop, and wrong by one whenever
*     the table simply ran out -- which is the common case and the one a
*     person would have believed
      lv_shown = lv_shown + 1.
      CLEAR lv_cells.
      LOOP AT ls_entity-fields INTO ls_field.
        ASSIGN COMPONENT ls_field-name OF STRUCTURE <ls_row> TO <lv_value>.
        IF <lv_value> IS ASSIGNED.
          lv_cells = |{ lv_cells }<td>{ esc( CONV string( <lv_value> ) ) }</td>|.
          UNASSIGN <lv_value>.
        ELSE.
          lv_cells = |{ lv_cells }<td class="dim">-</td>|.
        ENDIF.
      ENDLOOP.
      lv_rows = |{ lv_rows }<tr>{ lv_cells }</tr>|.
    ENDLOOP.

    rv_html = |<p class="note"><a href="?">All entities</a> &middot; | &&
              |<b>{ esc( iv_name ) }</b> &middot; { lines( <lt_table> ) } row(s), | &&
              |showing { lv_shown } | &&
              |&middot; read through <b>{ esc( ls_entity-source_class ) }</b></p>| &&
              |<table class="rows"><tr>{ lv_head }</tr>{ lv_rows }</table>|.
  ENDMETHOD.

  METHOD page.
    DATA lv_title TYPE string.

    lv_title = `Data browser`.
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
      `table.rows{border-collapse:collapse;background:#fff}` &&
      `table.rows th,table.rows td{border:1px solid #b9c6d6;padding:3px 8px;text-align:left;` &&
      `white-space:nowrap;font:12px "Courier New",monospace}` &&
      `table.rows th{background:#dbe7f4;font:12px "72","Segoe UI",Arial,sans-serif}` &&
      `</style></head><body>` &&
      |<div class="hd"><b>Data browser</b><span>{ esc( lv_title ) }</span></div>| &&
      |<div class="pane">{ iv_body }</div></body></html>|.
  ENDMETHOD.

ENDCLASS.
