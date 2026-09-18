CLASS zcl_osd_note DEFINITION PUBLIC FINAL CREATE PUBLIC.

* ZOSD_NOTE, the session notepad: the transaction that proves the loop
* (backlog G.3, docs/webgui.md).
*
* A field, an Add button, and the list of what was added. That is the whole
* of it on purpose. What it demonstrates is not a notepad, it is the three
* things a transaction needs and a function call does not:
*
*   it draws through the GUI substitutes -- a cl_gui_html_viewer in a
*   container, the document loaded into it, rendered by
*   cl_gui_control=>render_html into the Easy Access screen's body
*
*   a click comes back as an ABAP event -- sapevent on that viewer, the
*   round trip G.2 proved, used here rather than repeated
*
*   the conversation survives the request -- what was typed in the first
*   request is in the list in the second, because ROLL_OUT wrote it into
*   the session row and ROLL_IN read it back. A second browser gets its own
*   session id and its own empty list
*
* The state is a string, and this class is where that limit shows: the notes
* are a table of strings serialized with /ui2/cl_json, and nothing that is
* not serializable can live here. That is what the session design gave up
* and it is written down in docs/webgui.md rather than discovered later.
  PUBLIC SECTION.
    INTERFACES zif_osd_transaction.

    CONSTANTS gc_tcode TYPE string VALUE 'ZOSD_NOTE'.

*   the events this document raises, which is the transaction's PAI
    CONSTANTS:
      BEGIN OF gc_event,
        add   TYPE string VALUE 'add',
        clear TYPE string VALUE 'clear',
      END OF gc_event.

    TYPES: BEGIN OF ty_state,
*            what is in the field, so a screen comes back with it still there
             draft TYPE string,
*            what Add has collected
             notes TYPE STANDARD TABLE OF string WITH DEFAULT KEY,
           END OF ty_state.

*   PAI. The handler of the control's own event, the way a program that
*   builds an HTML viewer writes one: SET HANDLER ... FOR EVENT sapevent OF
*   cl_gui_html_viewer, in PBO below.
    METHODS on_sapevent FOR EVENT sapevent OF cl_gui_html_viewer
      IMPORTING action query_table.

*   what the transaction holds right now; the tests read it
    METHODS state
      RETURNING VALUE(rs_state) TYPE ty_state.

  PRIVATE SECTION.
    DATA ms_state TYPE ty_state.
    DATA mv_message TYPE string.
    DATA mo_container TYPE REF TO cl_gui_custom_container.
    DATA mo_viewer TYPE REF TO cl_gui_html_viewer.

    METHODS document
      RETURNING VALUE(rv_html) TYPE string.

    METHODS esc
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_text) TYPE string.

ENDCLASS.


CLASS zcl_osd_note IMPLEMENTATION.

  METHOD esc.
    rv_text = cl_gui_control=>escape_html( iv_text ).
  ENDMETHOD.

  METHOD state.
    rs_state = ms_state.
  ENDMETHOD.

  METHOD zif_osd_transaction~title.
    rv_title = 'Session notepad'.
  ENDMETHOD.

  METHOD zif_osd_transaction~message.
    rv_message = mv_message.
  ENDMETHOD.

  METHOD zif_osd_transaction~roll_in.
    CLEAR ms_state.
    IF iv_state IS INITIAL.
      RETURN.
    ENDIF.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_state
                               CHANGING  data = ms_state ).
  ENDMETHOD.

  METHOD zif_osd_transaction~roll_out.
    rv_state = /ui2/cl_json=>serialize( data = ms_state ).
  ENDMETHOD.

  METHOD on_sapevent.
* PAI. query_table is the form the browser posted, parsed, which is what a
* classic handler reads: name and value, the value a CHAR 250, so a note is
* as long as the frontend ever let one be.
    DATA ls_query TYPE cnht_query_struct.
    DATA lv_note  TYPE string.

    CLEAR mv_message.
    LOOP AT query_table INTO ls_query.
      IF ls_query-name = 'note'.
        lv_note = ls_query-value.
        CONDENSE lv_note.
      ENDIF.
    ENDLOOP.

    CASE action.
      WHEN gc_event-add.
        IF lv_note IS INITIAL.
          mv_message = 'Type something first'.
          RETURN.
        ENDIF.
        APPEND lv_note TO ms_state-notes.
        CLEAR ms_state-draft.
        mv_message = |Added "{ lv_note }", { lines( ms_state-notes ) } in this session|.
      WHEN gc_event-clear.
        CLEAR ms_state-notes.
        ms_state-draft = lv_note.
        mv_message = 'The list of this session is empty again'.
      WHEN OTHERS.
* an action this transaction does not have. Saying so beats redrawing the
* same screen and leaving somebody to wonder whether the click arrived.
        ms_state-draft = lv_note.
        mv_message = |{ action } is not something the notepad does|.
    ENDCASE.
  ENDMETHOD.

  METHOD document.
    DATA lv_note TYPE string.
    DATA lv_list TYPE string.
    DATA lv_i    TYPE i.

    IF ms_state-notes IS INITIAL.
      lv_list = `<p class="none">Nothing in this session yet.</p>`.
    ELSE.
      lv_list = `<ol class="notes">`.
      LOOP AT ms_state-notes INTO lv_note.
        lv_i = lv_i + 1.
        lv_list = lv_list && |<li data-note="{ lv_i }">{ esc( lv_note ) }</li>|.
      ENDLOOP.
      lv_list = lv_list && `</ol>`.
    ENDIF.

* The document. Written in backtick literals where it is static, so nothing
* has to be escaped, and through esc( ) where it is not: the one trap this
* tree has paid for twice is a page written from ABAP that thinks it can
* escape something (docs/retro-2026-09-17.md).
*
* The form's action is a sapevent, which is what makes it a transaction
* rather than a page: cl_gui_control=>render_html rewrites it into a form
* that posts back to ZCL_OSD_TRAN with the session id beside it, and
* cl_gui_html_viewer=>dispatch_sapevent turns the post back into the event
* above.
    rv_html =
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>` &&
      `body{font:13px system-ui,sans-serif;margin:0;padding:10px;background:#fff;color:#222}` &&
      `h2{margin:0 0 8px;font-size:14px;font-weight:600;color:#1f4e79}` &&
      `label{display:block;margin:0 0 3px;color:#40566b}` &&
      `input[type=text]{width:60%;padding:3px 5px;border:1px solid #6b8298}` &&
      `input[type=submit]{padding:3px 10px;margin-left:4px}` &&
      `ol.notes{margin:10px 0 0 18px;padding:0}ol.notes li{margin:2px 0}` &&
      `p.none{margin:10px 0 0;color:#6b8298;font-style:italic}` &&
      `</style></head><body>` &&
      `<h2>Session notepad</h2>` &&
      `<form method="post" id="note-form" action="sapevent:` && gc_event-add && `">` &&
      `<label for="note">A line to remember for as long as this session lasts</label>` &&
      |<input type="text" name="note" id="note" value="{ esc( ms_state-draft ) }">| &&
      `<input type="submit" id="add" value="Add">` &&
      `<input type="submit" id="clear" value="Clear" formaction="sapevent:` && gc_event-clear && `">` &&
      `</form>` && lv_list &&
      `</body></html>`.
  ENDMETHOD.

  METHOD zif_osd_transaction~pbo.
* PBO. The controls are built from scratch every dialog step, because
* cl_gui_control's snapshots are class data and ZCL_OSD_TRAN clears them:
* what the screen shows is what this state draws, and nothing survives from
* the last request that the state did not carry.
    DATA lt_html   TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lt_events TYPE cntl_simple_events.
    DATA ls_event  LIKE LINE OF lt_events.
    DATA lv_html   TYPE string.
* assigned_url is a generic c of the control, not a string: a document
* loaded without a url gets one assigned and show_url names it back
    DATA lv_url  TYPE c LENGTH 255.

    CREATE OBJECT mo_container
      EXPORTING
        container_name = 'OSD_NOTE'.
    CREATE OBJECT mo_viewer
      EXPORTING
        parent = mo_container.

* Registering sapevent is what tells the control framework that the anchors
* and forms of this document are meant to come back, and it is registered
* the way a program registers it -- a CNTL_SIMPLE_EVENTS row with the
* control's own event id, appl_event set -- because that is the call a real
* one makes (zcl_abapgit_html_viewer_gui does exactly this). Without it
* render_html leaves "sapevent:add" in the markup and the browser goes
* looking for a protocol nobody serves.
    ls_event-eventid    = cl_gui_html_viewer=>m_id_sapevent.
    ls_event-appl_event = abap_true.
    APPEND ls_event TO lt_events.
    mo_viewer->set_registered_events( lt_events ).

    SET HANDLER on_sapevent FOR mo_viewer.

    lv_html = document( ).
    APPEND lv_html TO lt_html.
    CALL METHOD mo_viewer->load_data
      EXPORTING
        type         = 'text'
        subtype      = 'html'
        size         = strlen( lv_html )
      IMPORTING
        assigned_url = lv_url
      CHANGING
        data_table   = lt_html
      EXCEPTIONS
        OTHERS       = 1.
    IF sy-subrc = 0.
      CALL METHOD mo_viewer->show_url
        EXPORTING
          url    = lv_url
        EXCEPTIONS
          OTHERS = 1.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
