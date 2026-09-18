CLASS zcl_osd_tran DEFINITION PUBLIC FINAL CREATE PUBLIC.

* One dialog step of a transaction (backlog G.3, docs/webgui.md).
*
* SAP Easy Access resolves a code to a node and a node of kind TRANSACTION
* is one the system runs rather than links to. This is the running: find the
* object by name in the generated registry, decide it is executable, enter
* it, and give ZCL_OSD_WEBGUI what it drew so that it goes where the tree
* usually is.
*
* The step is the dynpro cycle, written as one:
*
*   ROLL IN   the state string out of the session row (ZCL_OSD_TRAN_SESSION)
*   PBO       zif_osd_transaction~pbo builds the controls for that state
*   PAI       cl_gui_html_viewer=>dispatch_sapevent raises sapevent on the
*             viewer PBO built; the transaction's own handler changes its
*             own state. Not on the first step -- nothing was clicked yet
*   PBO       again, after clear( ), so what is rendered is the state after
*             the click rather than before it
*   render    cl_gui_control=>render_html of whatever controls exist now
*   ROLL OUT  the state back into the row
*
* The transport carries one field of its own, the session id: render_html
* writes it as a hidden input into every rewritten form and dispatch_sapevent
* strips it out again before raising, which is exactly what ty_sapevent-fields
* is for. So the session travels inside the document and the transaction
* never sees it.
*
* Nothing here is class data. That is the point of G.3: the state between two
* HTTP requests is a row keyed by a session id, so two browsers do not
* collide, a work process dying does not lose the conversation, and the
* browser deployment -- one service worker, no pool to pin to -- runs the
* same code.
  PUBLIC SECTION.

* where a dialog step posts back to: a sub-path of the Easy Access node, so
* the screen around the transaction is the same screen
    CONSTANTS gc_path TYPE string VALUE '/sap/bc/gui/sap/its/webgui/tx/'.
    CONSTANTS gc_action_field TYPE string VALUE 'okcode'.
    CONSTANTS gc_session_field TYPE string VALUE 'osdsid'.

    TYPES: BEGIN OF ty_step,
*            abap_true when the transaction is running and drew something
             ok      TYPE abap_bool,
*            abap_true when the registry has a *.tran.xml for this code at
*            all. A node of the screen that no tran object backs -- ZABAPGIT
*            is the one -- is not "does not exist"; the screen knows it and
*            knows what it is missing, so it says that instead
             known   TYPE abap_bool,
*            what to put where the tree usually is
             body    TYPE string,
*            the line for the status bar: the reason, or the transaction's own
             message TYPE string,
*            the session this step belongs to, for the next request
             sessid  TYPE string,
             tcode   TYPE string,
             title   TYPE string,
             step    TYPE i,
           END OF ty_step.

* enter a transaction: a new session, the first PBO, nothing dispatched
    CLASS-METHODS start
      IMPORTING iv_tcode       TYPE string
      RETURNING VALUE(rs_step) TYPE ty_step.

* go on with one: the click, and the screen it leads to
    CLASS-METHODS resume
      IMPORTING iv_query       TYPE string
                iv_body        TYPE string
      RETURNING VALUE(rs_step) TYPE ty_step.

* the session id a posted form carries, out of the query string or the body
    CLASS-METHODS session_of
      IMPORTING iv_query        TYPE string
                iv_body         TYPE string
      RETURNING VALUE(rv_sessid) TYPE string.

* how a document of this transaction posts back
    CLASS-METHODS transport
      IMPORTING iv_sessid          TYPE string
      RETURNING VALUE(rs_sapevent) TYPE cl_gui_control=>ty_sapevent.

  PRIVATE SECTION.

* PBO: the controls, from scratch, for the state the instance is in
    CLASS-METHODS draw
      IMPORTING ii_tran        TYPE REF TO zif_osd_transaction
                iv_sessid      TYPE string
      RETURNING VALUE(rv_html) TYPE string.

    CLASS-METHODS field_of
      IMPORTING iv_form         TYPE string
                iv_name         TYPE string
      RETURNING VALUE(rv_value) TYPE string.

ENDCLASS.


CLASS zcl_osd_tran IMPLEMENTATION.

  METHOD transport.
    DATA ls_field TYPE cl_gui_control=>ty_field.

    rs_sapevent-url = gc_path.
    rs_sapevent-action_field = gc_action_field.
    ls_field-name = gc_session_field.
    ls_field-value = iv_sessid.
    APPEND ls_field TO rs_sapevent-fields.
  ENDMETHOD.

  METHOD field_of.
    DATA lt_pairs TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_pair  TYPE string.
    DATA lv_name  TYPE string.
    DATA lv_value TYPE string.

    SPLIT iv_form AT '&' INTO TABLE lt_pairs.
    LOOP AT lt_pairs INTO lv_pair.
      SPLIT lv_pair AT '=' INTO lv_name lv_value.
      IF lv_name = iv_name.
        rv_value = cl_http_utility=>unescape_url( lv_value ).
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD session_of.
* the query string first, because that is where a form whose action went
* into the url carries the transport's fields, and the body second
    rv_sessid = field_of( iv_form = iv_query iv_name = gc_session_field ).
    IF rv_sessid IS INITIAL.
      rv_sessid = field_of( iv_form = iv_body iv_name = gc_session_field ).
    ENDIF.
  ENDMETHOD.

  METHOD draw.
* One document per request, and that is not a limitation of the proof any
* more: cl_gui_control's snapshots are class data, so a step starts with an
* empty control framework and PBO fills it from the state. It is closer to a
* real PBO than keeping them would be.
    cl_gui_control=>clear( ).
    ii_tran->pbo( ).
    rv_html = cl_gui_control=>render_html( iv_document = abap_false
                                           is_sapevent = transport( iv_sessid ) ).
  ENDMETHOD.

  METHOD start.
    DATA ls_tran    TYPE zcl_osd_tran_registry=>ty_tran.
    DATA li_tran    TYPE REF TO zif_osd_transaction.
    DATA ls_session TYPE zcl_osd_tran_session=>ty_session.
    DATA lv_message TYPE string.

    ls_tran = zcl_osd_tran_registry=>describe( iv_tcode ).
    rs_step-tcode = to_upper( iv_tcode ).
    IF ls_tran-tcode IS INITIAL.
* no *.tran.xml names this code. The caller may still know the node --
* ZABAPGIT is a node of the menu with no tran object behind it -- so KNOWN
* says which of the two this is and the caller decides what to print.
      rs_step-message = |Transaction { rs_step-tcode } does not exist|.
      RETURN.
    ENDIF.
    rs_step-known = abap_true.
    IF ls_tran-runnable = abap_false.
      rs_step-message = |{ ls_tran-tcode } cannot be started here: { ls_tran-reason }|.
      RETURN.
    ENDIF.

    li_tran = zcl_osd_tran_registry=>create( ls_tran-tcode ).
    IF li_tran IS NOT BOUND.
* the registry said runnable and the generated CASE has no branch: that is a
* generation that does not match its own list, and saying so is better than
* a blank screen
      rs_step-message = |{ ls_tran-tcode } is registered as runnable and has no entry in the generated registry|.
      RETURN.
    ENDIF.

    ls_session = zcl_osd_tran_session=>start( ls_tran-tcode ).
    li_tran->roll_in( '' ).

    rs_step-body = draw( ii_tran = li_tran iv_sessid = ls_session-sessid ).
    zcl_osd_tran_session=>keep( iv_sessid = ls_session-sessid
                                iv_state  = li_tran->roll_out( )
                                iv_step   = ls_session-step ).

    lv_message = li_tran->message( ).
    IF lv_message IS INITIAL.
      lv_message = |{ ls_tran-text } started, session { ls_session-sessid }|.
    ENDIF.

    rs_step-ok      = abap_true.
    rs_step-sessid  = ls_session-sessid.
    rs_step-title   = li_tran->title( ).
    rs_step-step    = ls_session-step.
    rs_step-message = lv_message.
  ENDMETHOD.

  METHOD resume.
    DATA lv_sessid  TYPE string.
    DATA ls_session TYPE zcl_osd_tran_session=>ty_session.
    DATA li_tran    TYPE REF TO zif_osd_transaction.
    DATA lv_message TYPE string.

    lv_sessid = session_of( iv_query = iv_query iv_body = iv_body ).
    ls_session = zcl_osd_tran_session=>resume( lv_sessid ).
    rs_step-sessid = lv_sessid.
    rs_step-tcode  = ls_session-tcode.

    IF ls_session-expired = abap_true.
      rs_step-message = |Session { lv_sessid } of { ls_session-tcode } has expired| &&
                        | after { zcl_osd_tran_session=>gc_ttl_seconds } seconds of doing nothing|.
      RETURN.
    ENDIF.
    IF ls_session-found = abap_false.
* an id this system does not have: made up, or swept after the timeout. It
* is refused rather than half-answered with a fresh transaction, because
* starting over silently is how a lost conversation hides
      rs_step-message = |Session { lv_sessid } is not open here: it expired, or it was never started|.
      RETURN.
    ENDIF.

    li_tran = zcl_osd_tran_registry=>create( ls_session-tcode ).
    IF li_tran IS NOT BOUND.
      zcl_osd_tran_session=>drop( lv_sessid ).
      rs_step-message = |{ ls_session-tcode } is no longer runnable here; the session was ended|.
      RETURN.
    ENDIF.

    li_tran->roll_in( ls_session-state ).

* PBO, so the viewer the click belongs to exists again in this process, then
* PAI into it. The event is raised on the control and not read out of the
* request here: that is the round trip G.2 proved, used rather than repeated.
    draw( ii_tran = li_tran iv_sessid = lv_sessid ).
    cl_gui_html_viewer=>dispatch_sapevent( iv_query    = iv_query
                                           iv_body     = iv_body
                                           is_sapevent = transport( lv_sessid ) ).

* and PBO again, on the state the handler left
    rs_step-body = draw( ii_tran = li_tran iv_sessid = lv_sessid ).
    zcl_osd_tran_session=>keep( iv_sessid = lv_sessid
                                iv_state  = li_tran->roll_out( )
                                iv_step   = ls_session-step ).

    lv_message = li_tran->message( ).
    IF lv_message IS INITIAL.
      lv_message = |{ ls_session-tcode }, step { ls_session-step }|.
    ENDIF.

    rs_step-ok      = abap_true.
    rs_step-title   = li_tran->title( ).
    rs_step-step    = ls_session-step.
    rs_step-message = lv_message.
  ENDMETHOD.

ENDCLASS.
