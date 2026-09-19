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
* Wave 2 adds the two things that make it SE16 rather than a listing: a
* selection per field, and a choice of columns.
*
* The filter does **not** build its own WHERE. It builds select-options --
* SIGN / OPTION / LOW / HIGH, the structure the Gateway filter facet already
* speaks -- and hands them to `zcl_stg_request_context=>where_for_option`,
* which is the same code an OData `$filter` goes through. Two consequences,
* and both are the reason: a value is escaped by the one escaper in the
* system rather than by a second one written here, and a pattern typed into
* this screen means exactly what the same pattern means over the service. A
* browser whose filter disagreed with the application would be worse than no
* browser, because it would be believed.
*
* SE16's own conventions are kept: `*` and `+` are the pattern characters,
* `a..b` is a range, a leading `!` excludes. Nothing else is invented.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CONSTANTS c_default_max TYPE i VALUE 100.

    CLASS-METHODS entity_list
      RETURNING
        VALUE(rv_html) TYPE string.

    TYPES: BEGIN OF ty_criterion,
             field TYPE string,
             value TYPE string,
           END OF ty_criterion.
    TYPES tt_criterion TYPE STANDARD TABLE OF ty_criterion WITH DEFAULT KEY.

    CLASS-METHODS rows_of
      IMPORTING
        iv_name        TYPE string
        iv_max         TYPE i
        it_criteria    TYPE tt_criterion
        it_columns     TYPE string_table
      RETURNING
        VALUE(rv_html) TYPE string.

*   one typed-in value into one select-option, in SE16's own conventions
    CLASS-METHODS option_of
      IMPORTING
        iv_value         TYPE string
      RETURNING
        VALUE(rs_option) TYPE /iwbep/s_cod_select_option.

    CLASS-METHODS where_of
      IMPORTING
        is_entity       TYPE zcl_stg_cds_registry=>ty_entity
        it_criteria     TYPE tt_criterion
      RETURNING
        VALUE(rv_where) TYPE string.

    CLASS-METHODS selection_form
      IMPORTING
        is_entity      TYPE zcl_stg_cds_registry=>ty_entity
        it_criteria    TYPE tt_criterion
        it_columns     TYPE string_table
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
    DATA lv_name     TYPE string.
    DATA lv_max      TYPE i.
    DATA lv_body     TYPE string.
    DATA lv_raw      TYPE string.
    DATA ls_entity   TYPE zcl_stg_cds_registry=>ty_entity.
    DATA ls_field    TYPE zcl_stg_cds_registry=>ty_field.
    DATA lt_criteria TYPE tt_criterion.
    DATA ls_crit     TYPE ty_criterion.
    DATA lt_columns  TYPE string_table.
    DATA lv_columns  TYPE string.
    DATA lv_column   TYPE string.

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
*     The form fields are read **against the entity's own field list**, never
*     the other way round: a parameter naming a column that does not exist
*     cannot reach the WHERE, because nothing ever looks for it. The same
*     rule gives the column choice its validation for free.
      ls_entity = zcl_stg_cds_registry=>get( lv_name ).
      lv_columns = server->request->get_form_field( 'c' ).
      TRANSLATE lv_columns TO UPPER CASE.
      LOOP AT ls_entity-fields INTO ls_field.
*       the form field name is **lower case**, and that is not cosmetic:
*       `get_form_field` lower-cases the name it is asked for and compares it
*       against names stored exactly as they arrived, so a parameter with an
*       upper-case letter in it can be sent and never read (ANORMALIES,
*       "get_form_field lowercases the question and not the answer")
        lv_raw = server->request->get_form_field( |f_{ to_lower( ls_field-name ) }| ).
        IF lv_raw IS NOT INITIAL.
          ls_crit-field = ls_field-name.
          ls_crit-value = lv_raw.
          APPEND ls_crit TO lt_criteria.
        ENDIF.
        IF lv_columns IS NOT INITIAL.
          lv_column = |,{ lv_columns },|.
          IF lv_column CS |,{ ls_field-name },|.
            APPEND ls_field-name TO lt_columns.
          ENDIF.
        ENDIF.
      ENDLOOP.
      lv_body = rows_of( iv_name     = lv_name
                         iv_max      = lv_max
                         it_criteria = lt_criteria
                         it_columns  = lt_columns ).
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

  METHOD option_of.
*   SE16's conventions, and only those:
*     a..b   a range          -> BT
*     * +    pattern chars    -> CP
*     !x     exclude          -> the SIGN, not a separate option
*     x      equality         -> EQ
    DATA lv_value TYPE string.
    DATA lv_low   TYPE string.
    DATA lv_high  TYPE string.
    DATA lv_at    TYPE i.

    lv_value = iv_value.
    rs_option-sign = 'I'.
    IF strlen( lv_value ) > 1 AND lv_value(1) = '!'.
      rs_option-sign = 'E'.
      lv_value = lv_value+1.
    ENDIF.

    lv_at = find( val = lv_value sub = '..' ).
    IF lv_at > 0.
      lv_low  = lv_value(lv_at).
      lv_high = lv_value+lv_at.
      lv_high = lv_high+2.
      rs_option-option = 'BT'.
      rs_option-low    = lv_low.
      rs_option-high   = lv_high.
      RETURN.
    ENDIF.

    IF lv_value CA '*+'.
      rs_option-option = 'CP'.
    ELSE.
      rs_option-option = 'EQ'.
    ENDIF.
    rs_option-low = lv_value.
  ENDMETHOD.

  METHOD where_of.
    DATA ls_crit   TYPE ty_criterion.
    DATA ls_field  TYPE zcl_stg_cds_registry=>ty_field.
    DATA ls_option TYPE /iwbep/s_cod_select_option.
    DATA lv_clause TYPE string.

    LOOP AT it_criteria INTO ls_crit.
*     the field has to be one of the entity's own; a criterion for anything
*     else is dropped rather than quoted into the statement
      READ TABLE is_entity-fields INTO ls_field WITH KEY name = ls_crit-field.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      ls_option = option_of( ls_crit-value ).
*     the same builder an OData $filter goes through, so the same text
      lv_clause = zcl_stg_request_context=>where_for_option( iv_field  = ls_field-name
                                                             is_option = ls_option ).
      IF rv_where IS INITIAL.
        rv_where = lv_clause.
      ELSE.
        rv_where = |{ rv_where } AND { lv_clause }|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD selection_form.
    DATA ls_field TYPE zcl_stg_cds_registry=>ty_field.
    DATA ls_crit  TYPE ty_criterion.
    DATA lv_rows  TYPE string.
    DATA lv_value TYPE string.
    DATA lv_check TYPE string.
    DATA lv_shown TYPE abap_bool.

    LOOP AT is_entity-fields INTO ls_field.
      CLEAR lv_value.
      READ TABLE it_criteria INTO ls_crit WITH KEY field = ls_field-name.
      IF sy-subrc = 0.
        lv_value = ls_crit-value.
      ENDIF.
      lv_shown = abap_true.
      IF it_columns IS NOT INITIAL.
        READ TABLE it_columns TRANSPORTING NO FIELDS WITH KEY table_line = ls_field-name.
        IF sy-subrc <> 0.
          lv_shown = abap_false.
        ENDIF.
      ENDIF.
      lv_check = ``.
      IF lv_shown = abap_true.
        lv_check = ` checked`.
      ENDIF.
      lv_rows = |{ lv_rows }<tr><td><input type="checkbox" name="c" value="{ esc( ls_field-name ) }"{ lv_check }></td>| &&
                |<td class="fn">{ esc( ls_field-name ) }</td>| &&
                |<td><input name="f_{ esc( to_lower( ls_field-name ) ) }" value="{ esc( lv_value ) }" size="24"></td></tr>|.
    ENDLOOP.

    rv_html = |<form class="sel" method="get"><input type="hidden" name="t" value="{ esc( is_entity-name ) }">| &&
              `<table class="sel"><tr><th>Show</th><th>Field</th><th>Selection</th></tr>` &&
              lv_rows &&
              |<tr><td></td><td class="fn">Rows</td>| &&
              |<td><input name="max" value="{ iv_max }" size="6"> | &&
              `<button type="submit">Execute</button> ` &&
              |<a href="?t={ esc( is_entity-name ) }">Reset</a></td></tr>| &&
              `</table></form>` &&
              `<p class="note">A value is SE16's: <code>*</code> and <code>+</code> are the pattern ` &&
              `characters, <code>a..b</code> is a range, a leading <code>!</code> excludes. ` &&
              `It becomes a select-option and goes through the same clause builder as an ` &&
              `OData <code>$filter</code>, so the same text means the same thing in both.</p>`.
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
    DATA lv_where   TYPE string.
    DATA lv_form    TYPE string.
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

    lv_where = where_of( is_entity   = ls_entity
                         it_criteria = it_criteria ).

    TRY.
        lv_class = ls_entity-source_class.
        CREATE OBJECT lo_source TYPE (lv_class).
        lr_data = lo_source->read( iv_where   = lv_where
                                   it_orderby = lt_orderby ).
      CATCH cx_root INTO lx_root.
*       a source that cannot be created or cannot read says why, rather than
*       showing an empty table -- which reads as "there is nothing here"
*       the form comes back with it: a selection that the database refused is
*       exactly the moment a person needs to edit it, and a bare error with
*       no way back means retyping everything
        rv_html = selection_form( is_entity   = ls_entity
                                  it_criteria = it_criteria
                                  it_columns  = it_columns
                                  iv_max      = iv_max ) &&
                  |<div class="err"><b>{ esc( iv_name ) } could not be read</b>| &&
                  |<div class="msg">{ esc( lx_root->get_text( ) ) }</div>| &&
                  |<div class="msg">WHERE { esc( lv_where ) }</div></div>|.
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
      IF it_columns IS NOT INITIAL.
        READ TABLE it_columns TRANSPORTING NO FIELDS WITH KEY table_line = ls_field-name.
        IF sy-subrc <> 0.
          CONTINUE.
        ENDIF.
      ENDIF.
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
        IF it_columns IS NOT INITIAL.
          READ TABLE it_columns TRANSPORTING NO FIELDS WITH KEY table_line = ls_field-name.
          IF sy-subrc <> 0.
            CONTINUE.
          ENDIF.
        ENDIF.
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

    lv_form = selection_form( is_entity   = ls_entity
                              it_criteria = it_criteria
                              it_columns  = it_columns
                              iv_max      = iv_max ).

    rv_html = |<p class="note"><a href="?">All entities</a> &middot; | &&
              |<b>{ esc( iv_name ) }</b> &middot; { lines( <lt_table> ) } row(s), | &&
              |showing { lv_shown } | &&
              |&middot; read through <b>{ esc( ls_entity-source_class ) }</b></p>| &&
              lv_form &&
              |<p class="note">WHERE <code>{ esc( COND string( WHEN lv_where IS INITIAL THEN `(none)` ELSE lv_where ) ) }</code></p>| &&
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
      `form.sel{margin:0 0 12px}` &&
      `table.sel{border-collapse:collapse;background:#fff;border:1px solid #b9c6d6}` &&
      `table.sel th,table.sel td{border-bottom:1px solid #e2eaf3;padding:2px 8px;text-align:left}` &&
      `table.sel th{background:#dbe7f4;font:12px "72","Segoe UI",Arial,sans-serif}` &&
      `table.sel td.fn{font:12px "Courier New",monospace}` &&
      `code{font:12px "Courier New",monospace;background:#e7eef7;padding:0 3px}` &&
      `</style></head><body>` &&
      |<div class="hd"><b>Data browser</b><span>{ esc( lv_title ) }</span></div>| &&
      |<div class="pane">{ iv_body }</div></body></html>|.
  ENDMETHOD.

ENDCLASS.
