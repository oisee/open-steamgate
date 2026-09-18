CLASS zcl_osd_sapevent DEFINITION PUBLIC FINAL CREATE PUBLIC.

* The sapevent round trip, against abapGit's own markup (backlog G.2).
*
* Mounted under the Easy Access screen at
* /sap/bc/gui/sap/its/webgui/sapevent/. A GET draws a document through the
* GUI substitutes the way abapGit draws its pages, a POST is what a click in
* that document produces, and the answer to the POST is what abapGit's own
* event class made of it. It is a proof harness and says so; it is also the
* seed of what a transaction node needs (docs/webgui.md): controls drawn
* into a page, and the click coming back as an ABAP event.
*
* What is real here, and what is not, because the distinction is the point:
*
*   real   zcl_abapgit_html_viewer_gui, abapGit's wrapper of
*          cl_gui_html_viewer, constructed as abapGit constructs it (the
*          event registered, query_table disabled, SET HANDLER on the SAP
*          event), re-raising zif_abapgit_html_viewer~sapevent
*   real   zcl_abapgit_html, which writes every sapevent anchor of abapGit
*          (zcl_abapgit_html=>a: href="sapevent:ACTION?QUERY")
*   real   zcl_abapgit_gui_event, the class zcl_abapgit_gui=>handle_action
*          builds first from action, getdata and postdata, and the only
*          reader of them abapGit has: mv_action, query( ), form_data( )
*   real   cl_gui_html_viewer=>dispatch_sapevent and the sapevent raise, in
*          open-abap-gui (fork branch html-viewer-sapevent)
*   copied the form. abapGit's forms are written by zcl_abapgit_html_form,
*          and that class reaches zcl_abapgit_ui_factory and with it the
*          whole of abapGit (371 of 592 objects by name), so it does not
*          compile in this tree yet. The form below is the markup
*          zcl_abapgit_html_form=>render writes (the <form> with the main
*          command as its action and a hidden submit, a side action as a
*          submit with a formaction, lines 443-448, 547 and 991 of that
*          class) with the field ids and events of
*          zcl_abapgit_gui_page_addonline (c_id, c_event). A copy, and
*          labelled as one.
*   absent zcl_abapgit_gui itself. Its on_event is three lines that call
*          handle_action, whose first act is the CREATE OBJECT this class
*          repeats in ON_EVENT below; everything after that is the router
*          and the pages, which are the closure above.
*
* The state between the two requests, the viewer and its handler, is class
* data of this class: one document per process, not per session. That is
* enough for a proof and is exactly the part a transaction node has to do
* properly (docs/webgui.md, step 3).
  PUBLIC SECTION.
    INTERFACES if_http_extension.

    CONSTANTS gc_path TYPE string VALUE '/sap/bc/gui/sap/its/webgui/sapevent/'.
    CONSTANTS gc_action_field TYPE string VALUE 'sapevent'.

    TYPES ty_lines TYPE STANDARD TABLE OF string WITH DEFAULT KEY.

    DATA mv_raised   TYPE i READ-ONLY.
    DATA mv_action   TYPE string READ-ONLY.
    DATA mv_getdata  TYPE string READ-ONLY.
    DATA mt_postdata TYPE ty_lines READ-ONLY.
    DATA mo_form     TYPE REF TO zcl_abapgit_string_map READ-ONLY.
    DATA mo_query    TYPE REF TO zcl_abapgit_string_map READ-ONLY.
    DATA mv_error    TYPE string READ-ONLY.

* What zcl_abapgit_gui=>on_event does with the event it is handed.
    METHODS on_event FOR EVENT sapevent OF zif_abapgit_html_viewer
      IMPORTING action getdata postdata.

* The page: abapGit's document loaded into the viewer, rendered with the
* transport that posts back here.
    CLASS-METHODS page
      RETURNING
        VALUE(rv_html) TYPE string.

* abapGit's own document: the repository list's anchors, and the form of the
* "New Online Repository" page.
    CLASS-METHODS document
      RETURNING
        VALUE(rv_html) TYPE string.

    CLASS-METHODS transport
      RETURNING
        VALUE(rs_sapevent) TYPE cl_gui_control=>ty_sapevent.

* The handler the last page registered, or nothing before a page was drawn.
    CLASS-METHODS handler
      RETURNING
        VALUE(ro_handler) TYPE REF TO zcl_osd_sapevent.

* What the last click made of the event, as JSON.
    CLASS-METHODS trace
      IMPORTING
        iv_dispatched  TYPE abap_bool
      RETURNING
        VALUE(rv_json) TYPE string.

  PRIVATE SECTION.
    CLASS-DATA go_container TYPE REF TO cl_gui_custom_container.
    CLASS-DATA gi_viewer    TYPE REF TO zif_abapgit_html_viewer.
    CLASS-DATA go_handler   TYPE REF TO zcl_osd_sapevent.

    CLASS-METHODS json_string
      IMPORTING
        iv_text          TYPE string
      RETURNING
        VALUE(rv_result) TYPE string.
    CLASS-METHODS json_map
      IMPORTING
        io_map           TYPE REF TO zcl_abapgit_string_map
      RETURNING
        VALUE(rv_result) TYPE string.
ENDCLASS.

CLASS zcl_osd_sapevent IMPLEMENTATION.

  METHOD on_event.
* zcl_abapgit_gui=>on_event calls handle_action( iv_action = action
* iv_getdata = getdata it_postdata = postdata ), and handle_action begins
* with exactly this CREATE OBJECT. The event object is the whole of abapGit's
* reading of the parameters: action lower-cased, getdata split into query( ),
* postdata joined and split into form_data( ).
    DATA li_event TYPE REF TO zif_abapgit_gui_event.
    DATA lv_line  LIKE LINE OF postdata.
    DATA lx_error TYPE REF TO zcx_abapgit_exception.

    CREATE OBJECT li_event TYPE zcl_abapgit_gui_event
      EXPORTING
        iv_action   = action
        iv_getdata  = getdata
        it_postdata = postdata.

    mv_raised = mv_raised + 1.
    mv_action = li_event->mv_action.
    mv_getdata = li_event->mv_getdata.
    CLEAR mt_postdata.
    LOOP AT postdata INTO lv_line.
      APPEND lv_line TO mt_postdata.
    ENDLOOP.
    CLEAR mv_error.
    TRY.
        mo_form = li_event->form_data( ).
        mo_query = li_event->query( ).
      CATCH zcx_abapgit_exception INTO lx_error.
        mv_error = lx_error->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD transport.
    rs_sapevent-url = gc_path.
    rs_sapevent-action_field = gc_action_field.
  ENDMETHOD.

  METHOD handler.
    ro_handler = go_handler.
  ENDMETHOD.

  METHOD document.
    DATA li_html TYPE REF TO zif_abapgit_html.

    li_html = zcl_abapgit_html=>create( ).

* the repository list: the name of a repository is an anchor written by
* zcl_abapgit_html=>a with the page's select action and the key as its query
* (zcl_abapgit_gui_page_repo_over, render_table_item)
    li_html->add( '<div class="repo-overview"><table class="repo-overview-table"><thead>' ).
    li_html->add( '<tr><th>Type</th><th>Name</th><th>Package</th></tr></thead><tbody>' ).
    li_html->add( '<tr class="repo"><td class="wmin">online</td><td>' ).
    li_html->add( li_html->a( iv_txt = 'open-steamgate'
                              iv_act = 'select?key=000000000001' ) ).
    li_html->add( '</td><td>$OSD</td></tr>' ).
    li_html->add( '<tr class="repo"><td class="wmin">offline</td><td>' ).
    li_html->add( li_html->a( iv_txt = 'open-abap-gui'
                              iv_act = 'select?key=000000000002' ) ).
    li_html->add( '</td><td>$GUI</td></tr></tbody></table></div>' ).
    li_html->add( '<div class="toolbar">' ).
    li_html->add( li_html->a( iv_txt = 'New Online'
                              iv_act = zif_abapgit_definitions=>c_action-repo_newonline ) ).
    li_html->add( '</div>' ).

* the "New Online Repository" page: the form as zcl_abapgit_html_form=>render
* writes it, for the fields zcl_abapgit_gui_page_addonline declares
    li_html->add( '<div class="dialog">' ).
    li_html->add( '<form method="post" id="add-repo-online-form" action="sapevent:add-repo-online">' ).
    li_html->add( '<button type="submit" formaction="sapevent:add-repo-online" class="hidden-submit" aria-hidden="true" tabindex="-1"></button>' ).
    li_html->add( '<ul>' ).
    li_html->add( '<li><label for="url">Git Repository URL</label>' ).
    li_html->add( '<input type="text" name="url" id="url" value=""></li>' ).
    li_html->add( '<li><label for="package">Package</label>' ).
    li_html->add( '<input type="text" name="package" id="package" value="">' ).
    li_html->add( '<input type="submit" value="&#x2026;" formaction="sapevent:choose-package"></li>' ).
    li_html->add( '<li><label for="branch_name">Branch</label>' ).
    li_html->add( '<input type="text" name="branch_name" id="branch_name" value="">' ).
    li_html->add( '<input type="submit" value="&#x2026;" formaction="sapevent:choose-branch"></li>' ).
    li_html->add( '<li><label for="display_name">Display Name</label>' ).
    li_html->add( '<input type="text" name="display_name" id="display_name" value=""></li>' ).
    li_html->add( '<li><label for="folder_logic">Folder Logic</label>' ).
    li_html->add( '<select name="folder_logic" id="folder_logic"><option value="PREFIX" selected>Prefix</option><option value="FULL">Full</option></select></li>' ).
    li_html->add( '</ul>' ).
    li_html->add( '<div class="dialog-commands">' ).
    li_html->add( '<input type="submit" value="Create Online Repo" class="main" id="main-button">' ).
    li_html->add( '<input type="submit" value="Create Package" formaction="sapevent:create-package">' ).
    li_html->add( '</div></form></div>' ).

    rv_html = li_html->render( ).
  ENDMETHOD.

  METHOD page.
    TYPES ty_char TYPE c LENGTH 200.
    DATA lt_html    TYPE STANDARD TABLE OF ty_char WITH DEFAULT KEY.
    DATA lv_size    TYPE i.
    DATA lv_url     TYPE string.
    DATA lv_section TYPE string.

* one document per process: whatever the last page drew goes
    cl_gui_control=>clear( ).
    CREATE OBJECT go_container
      EXPORTING
        container_name = 'OSD_SAPEVENT'.
    CREATE OBJECT gi_viewer TYPE zcl_abapgit_html_viewer_gui
      EXPORTING
        io_container           = go_container
        iv_disable_query_table = abap_true.
    CREATE OBJECT go_handler.
    SET HANDLER go_handler->on_event FOR gi_viewer.

* as zcl_abapgit_gui=>cache_asset and render do it: the document as a table
* of lines into load_data, then show_url of what load_data assigned
    zcl_abapgit_convert=>string_to_tab(
      EXPORTING
        iv_str  = document( )
      IMPORTING
        ev_size = lv_size
        et_tab  = lt_html ).
    TRY.
        gi_viewer->load_data(
          EXPORTING
            iv_type         = 'text'
            iv_subtype      = 'html'
            iv_size         = lv_size
            iv_url          = 'abapgit.html'
          IMPORTING
            ev_assigned_url = lv_url
          CHANGING
            ct_data_table   = lt_html ).
        gi_viewer->show_url( lv_url ).
      CATCH zcx_abapgit_exception.
        ASSERT 1 = 2.
    ENDTRY.

    lv_section = cl_gui_control=>render_html( iv_document = abap_false
                                              is_sapevent = transport( ) ).

    rv_html = `<!doctype html><html lang="en"><head><meta charset="utf-8">` &&
      `<title>sapevent round trip</title>` &&
      `<style>body{margin:0;font:13px system-ui,sans-serif;background:#e8eef4}` &&
      `h1{margin:0;padding:8px 12px;background:#1f4e79;color:#fff;font-size:14px;font-weight:normal}` &&
      `.gg-controls{position:relative;min-height:0}.gg-controls iframe{position:relative;width:100%;height:70vh;border:1px solid #6b8298;background:#fff}` &&
      `p{margin:8px 12px}</style></head><body>` &&
      `<h1>sapevent round trip: abapGit's markup in cl_gui_html_viewer, a click coming back as the event</h1>` &&
      `<p>Click a repository, or fill the form and create the repository. What abapGit's event class ` &&
      `made of the click comes back as JSON.</p>` &&
      lv_section && `</body></html>`.
  ENDMETHOD.

  METHOD json_string.
    rv_result = iv_text.
    REPLACE ALL OCCURRENCES OF '\' IN rv_result WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_result WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_result WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf(1) IN rv_result WITH '\r'.
    rv_result = |"{ rv_result }"|.
  ENDMETHOD.

  METHOD json_map.
    DATA ls_entry LIKE LINE OF io_map->mt_entries.
    DATA lv_sep   TYPE string.

    rv_result = `{`.
    IF io_map IS BOUND.
      LOOP AT io_map->mt_entries INTO ls_entry.
        rv_result = rv_result && lv_sep && json_string( ls_entry-k ) && `:` && json_string( ls_entry-v ).
        lv_sep = `,`.
      ENDLOOP.
    ENDIF.
    rv_result = rv_result && `}`.
  ENDMETHOD.

  METHOD trace.
    DATA lv_line TYPE string.
    DATA lv_sep  TYPE string.

    rv_json = |\{"dispatched":{ COND string( WHEN iv_dispatched = abap_true THEN 'true' ELSE 'false' ) }|.
    IF go_handler IS NOT BOUND.
      rv_json = rv_json && `,"raised":0}`.
      RETURN.
    ENDIF.
    rv_json = rv_json && |,"raised":{ go_handler->mv_raised }| &&
      `,"action":` && json_string( go_handler->mv_action ) &&
      `,"getdata":` && json_string( go_handler->mv_getdata ) &&
      `,"postdata":[`.
    LOOP AT go_handler->mt_postdata INTO lv_line.
      rv_json = rv_json && lv_sep && json_string( lv_line ).
      lv_sep = `,`.
    ENDLOOP.
    rv_json = rv_json && `],"query":` && json_map( go_handler->mo_query ) &&
      `,"form":` && json_map( go_handler->mo_form ) &&
      `,"error":` && json_string( go_handler->mv_error ) && `}`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_method     TYPE string.
    DATA lv_dispatched TYPE abap_bool.

    lv_method = server->request->get_method( ).
    IF lv_method = 'POST'.
* the click: the form the rendering made of an anchor or of the document's
* own form, as the browser posted it, handed to the viewer that drew it
      lv_dispatched = cl_gui_html_viewer=>dispatch_sapevent(
        iv_query    = server->request->get_header_field( '~query_string' )
        iv_body     = server->request->get_cdata( )
        is_sapevent = transport( ) ).
      server->response->set_header_field( name = 'content-type' value = 'application/json; charset=utf-8' ).
      server->response->set_cdata( trace( lv_dispatched ) ).
      RETURN.
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( ) ).
  ENDMETHOD.

ENDCLASS.
