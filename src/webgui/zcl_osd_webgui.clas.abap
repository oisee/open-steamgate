CLASS zcl_osd_webgui DEFINITION PUBLIC FINAL CREATE PUBLIC.

* Easy Success, served by ABAP: the screen SAP calls Easy Access, at the path
* the real ITS webgui answers on, under a name of our own.
*
* The name is the last step of the rule Alice set in G.1c - what we invent
* carries no trademark, what states a fact about SAP software keeps the word.
* "Easy Access" was still somebody else's screen name worn by ours. "Easy
* Success" keeps the cadence and turns the promise over, the way the slogan
* under the wordmark does, and it is a joke this project is entitled to make
* because it is about itself. Every comment below that describes the real
* screen still says Easy Access: there it is a statement of fact, and
* changing it would make the sentence false.
*
* Mounted at /sap/bc/gui/sap/its/webgui/, which is the path the real ITS
* webgui lives at on a system. That is a deliberate nod and not an accident:
* what answers there on a real system is the SAP GUI in a browser, and what
* answers here is the same entry screen drawn by a class of this tree. Using
* the address makes the claim out loud, and it costs nothing, because
* nothing of SAP's is mounted anywhere near it.
*
* The screen is the classic one: the title bar, the command field, the menu
* of folders on the left with their disclosure triangles, and the tall image
* panel down the right-hand side.
*
* Nothing in the menu is typed out here. The rows come from the five status
* tables (src/status/, ZOSD_STATUS_SRV), which the facade fills from one
* snapshot of what this instance actually serves (tools/osd-status.mjs):
* ZOSD_SVC has a row per OData service, ICF service, push channel and UI5
* application, ZOSD_PACK a row per content pack, ZOSD_SYS the system itself.
* Reading them rather than walking the tree again is the point: a menu that
* disagrees with the system status is a menu that is wrong somewhere, and
* there is only one list to be wrong.
*
* A node is one of four kinds, and the kind is part of the model rather than
* something the renderer guesses:
*
*   FOLDER       a branch, with no target of its own
*   APP          a UI5 application, opened at the intent its manifest declares
*   SERVICE      an OData service, an ICF node, a push channel, a pack
*   TRANSACTION  something the system runs rather than something it links to
*
* TRANSACTION nodes are real since backlog G.3: they come from the *.tran.xml
* objects of the layers through the generated ZCL_OSD_TRAN_REGISTRY, and a
* runnable one is entered by ZCL_OSD_TRAN, whose markup goes where the tree
* goes (page( iv_body )). One that cannot be entered here says which of the
* reasons it is -- a report, a dynpro, a class that is not in this tree --
* rather than "not yet". ZABAPGIT is the exception and is typed out below:
* this tree carries no zabapgit.tran.xml, and the node says so. It is the
* seat G.4 will sit in. docs/webgui.md has the rule and the session design.
*
* The menu bar is not decoration either: what it offers, it does. System >
* Status opens the status app at the target the tree's own node carries,
* System > Log off goes to the launchpad, Help > About is a page of this
* class at /about, and everything that is not wired to anything is greyed
* and says so. The bar folds out on hover and on focus, in CSS: this screen
* still has no JavaScript on it.
*
* The status bar tells the truth. It used to print an invented session
* number and an invented client; it now prints sy-sysid, sy-mandt and
* sy-uname -- which the boot sets from tools/osd-identity.mjs, the one place
* this system says who it is -- and the work process the tables were written
* in, where SAP GUI prints the session number (ZOSD_SYS-PID).
*
* The command field is the second way in, beside the tree, because that is
* how a system works: you type a name and it takes you there. It is resolved
* on the server, against the same node list the tree is built from, so the
* field and the tree can never send you to two different places. /n and /o
* are stripped the way SAP strips them; an unknown code comes back as the
* message SAP puts in the status bar.
  PUBLIC SECTION.
    INTERFACES if_http_extension.

    CONSTANTS gc_path TYPE string VALUE '/sap/bc/gui/sap/its/webgui'.

    CONSTANTS:
      BEGIN OF gc_kind,
        folder      TYPE string VALUE 'FOLDER',
        app         TYPE string VALUE 'APP',
        service     TYPE string VALUE 'SERVICE',
        transaction TYPE string VALUE 'TRANSACTION',
      END OF gc_kind.

    TYPES: BEGIN OF ty_node,
             id     TYPE string,
             parent TYPE string,
             kind   TYPE string,
             name   TYPE string,
             text   TYPE string,
             url    TYPE string,
             detail TYPE string,
             badge  TYPE string,
           END OF ty_node.
    TYPES tt_node TYPE STANDARD TABLE OF ty_node WITH DEFAULT KEY.

* who this system is, as the screen prints it. Nothing here is a literal of
* this class: the first three are sy, set at boot from the one identity
* (tools/osd-identity.mjs), and the last two are the status tables.
    TYPES: BEGIN OF ty_ident,
             sid       TYPE string,
             client    TYPE string,
             user      TYPE string,
             pid       TYPE string,
             host_kind TYPE string,
             info      TYPE string,
           END OF ty_ident.

    CLASS-METHODS identity
      RETURNING VALUE(rs_ident) TYPE ty_ident.

* what a node of this menu points at, by the name it is known by. The menu
* bar reads its targets from here rather than repeating them, so the bar and
* the tree cannot send you to two different places.
    CLASS-METHODS target
      IMPORTING it_nodes      TYPE tt_node
                iv_name       TYPE string
      RETURNING VALUE(rv_url) TYPE string.

* the menu of this system, as rows; the tree and the command field read this
    CLASS-METHODS menu
      RETURNING VALUE(rt_nodes) TYPE tt_node.

* what an ok-code names, or an initial node when the system has no such thing
    CLASS-METHODS resolve
      IMPORTING iv_code        TYPE string
      RETURNING VALUE(rs_node) TYPE ty_node.

* The screen. IV_BODY is what goes where the tree goes, which is how a
* running transaction gets on to this screen at all (backlog G.3): the pane
* used to be hard-wired to branch( ), so a transaction had nowhere to draw.
* The tree is what it renders when nobody passed a body, so the default is
* the screen as it always was.
    CLASS-METHODS page
      IMPORTING iv_message     TYPE string OPTIONAL
                iv_okcode      TYPE string OPTIONAL
                iv_body        TYPE string OPTIONAL
                iv_heading     TYPE string OPTIONAL
      RETURNING VALUE(rv_html) TYPE string.

  PRIVATE SECTION.

    CLASS-METHODS add
      IMPORTING iv_parent TYPE string
                iv_id     TYPE string
                iv_kind   TYPE string
                iv_text   TYPE string
                iv_name   TYPE string OPTIONAL
                iv_url    TYPE string OPTIONAL
                iv_detail TYPE string OPTIONAL
                iv_badge  TYPE string OPTIONAL
      CHANGING  ct_nodes  TYPE tt_node.

    CLASS-METHODS branch
      IMPORTING it_nodes      TYPE tt_node
                iv_parent     TYPE string
                iv_level      TYPE i DEFAULT 0
      RETURNING VALUE(rv_html) TYPE string.

    CLASS-METHODS has_children
      IMPORTING it_nodes      TYPE tt_node
                iv_id         TYPE string
      RETURNING VALUE(rv_yes) TYPE abap_bool.

    CLASS-METHODS leaf
      IMPORTING is_node       TYPE ty_node
      RETURNING VALUE(rv_html) TYPE string.

    CLASS-METHODS last_segment
      IMPORTING iv_path        TYPE string
      RETURNING VALUE(rv_name) TYPE string.

    CLASS-METHODS style
      RETURNING VALUE(rv_css) TYPE string.

    CLASS-METHODS artwork
      IMPORTING iv_sid         TYPE string
      RETURNING VALUE(rv_html) TYPE string.

* The one script on this screen, and what it buys (Alice, 2026-09-18).
    CLASS-METHODS drag_script
      RETURNING VALUE(rv_html) TYPE string.

* the menu bar, built out of the same node list the tree is
    CLASS-METHODS menubar
      IMPORTING it_nodes       TYPE tt_node
      RETURNING VALUE(rv_html) TYPE string.

* one entry of the bar, with the items it folds out
    CLASS-METHODS menu_entry
      IMPORTING iv_text        TYPE string
                iv_items       TYPE string
                iv_live        TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_html) TYPE string.

* an item of a fold-out: an anchor when it goes somewhere, and visibly
* disabled when it does not. A menu that swallows a click silently is worse
* than one that admits it is not wired to anything.
    CLASS-METHODS menu_item
      IMPORTING iv_text        TYPE string
                iv_url         TYPE string OPTIONAL
      RETURNING VALUE(rv_html) TYPE string.

* Help > About: what this system is, out of sy and the status tables
    CLASS-METHODS about
      RETURNING VALUE(rv_html) TYPE string.

    CLASS-METHODS about_row
      IMPORTING iv_label       TYPE string
                iv_value       TYPE string
      RETURNING VALUE(rv_html) TYPE string.

* cl_gui_control=>escape_html, under a shorter name. The escaping of this
* page comes out of open-abap-gui, the GUI substitute library, rather than
* out of a copy of it here: the same class that will escape abapGit's HTML
* when that arrives escapes this screen today.
    CLASS-METHODS esc
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_text) TYPE string.

ENDCLASS.


CLASS zcl_osd_webgui IMPLEMENTATION.

  METHOD esc.
    rv_text = cl_gui_control=>escape_html( iv_text ).
  ENDMETHOD.

  METHOD last_segment.
    DATA lt_parts TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    SPLIT iv_path AT '/' INTO TABLE lt_parts.
    READ TABLE lt_parts INTO rv_name INDEX lines( lt_parts ).
    TRANSLATE rv_name TO UPPER CASE.
  ENDMETHOD.

  METHOD add.
    DATA ls_node TYPE ty_node.

    ls_node-id     = iv_id.
    ls_node-parent = iv_parent.
    ls_node-kind   = iv_kind.
    ls_node-text   = iv_text.
    ls_node-name   = iv_name.
    ls_node-url    = iv_url.
    ls_node-detail = iv_detail.
    ls_node-badge  = iv_badge.
    IF ls_node-name IS INITIAL.
      ls_node-name = iv_id.
      TRANSLATE ls_node-name TO UPPER CASE.
    ENDIF.
    APPEND ls_node TO ct_nodes.
  ENDMETHOD.

  METHOD menu.
    DATA ls_svc  TYPE zosd_svc.
    DATA ls_pack TYPE zosd_pack.
    DATA lt_tran TYPE zcl_osd_tran_registry=>tt_tran.
    DATA ls_tran TYPE zcl_osd_tran_registry=>ty_tran.
    DATA lv_name TYPE string.
    DATA lv_url  TYPE string.

* Favourites, which on a real system is whatever the user put there. Here it
* is the two ways into the rest of the system: the launchpad, and the one
* transaction this screen knows about.
    add( EXPORTING iv_parent = '' iv_id = 'FAVORITES' iv_kind = gc_kind-folder
                   iv_text = 'Favorites'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'FAVORITES' iv_id = 'FLP' iv_kind = gc_kind-app
                   iv_text = 'Fiori launchpad' iv_name = 'FLP'
                   iv_url = '/app/flp.html' iv_detail = 'webapp/flp.html'
                   iv_badge = 'APP'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'FAVORITES' iv_id = 'ZABAPGIT' iv_kind = gc_kind-transaction
                   iv_text = 'abapGit' iv_name = 'ZABAPGIT'
                   iv_detail = 'no zabapgit.tran.xml in this tree: backlog G.4'
                   iv_badge = 'TCODE'
         CHANGING  ct_nodes = rt_nodes ).

    add( EXPORTING iv_parent = '' iv_id = 'MENU' iv_kind = gc_kind-folder
                   iv_text = 'OSD Menu'
         CHANGING  ct_nodes = rt_nodes ).

    add( EXPORTING iv_parent = 'MENU' iv_id = 'APPS' iv_kind = gc_kind-folder
                   iv_text = 'Applications'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'MENU' iv_id = 'SERVICES' iv_kind = gc_kind-folder
                   iv_text = 'Services'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'SERVICES' iv_id = 'ODATA' iv_kind = gc_kind-folder
                   iv_text = 'OData Services'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'SERVICES' iv_id = 'ICF' iv_kind = gc_kind-folder
                   iv_text = 'ICF Services'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'SERVICES' iv_id = 'APC' iv_kind = gc_kind-folder
                   iv_text = 'Push Channels'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'MENU' iv_id = 'PACKS' iv_kind = gc_kind-folder
                   iv_text = 'Content Packs'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'MENU' iv_id = 'TOOLS' iv_kind = gc_kind-folder
                   iv_text = 'Tools'
         CHANGING  ct_nodes = rt_nodes ).

    SELECT * FROM zosd_svc INTO ls_svc ORDER BY kind path.
      CLEAR: lv_name, lv_url.
      CASE ls_svc-kind.
        WHEN 'ODATA'.
          lv_name = last_segment( CONV string( ls_svc-path ) ).
          lv_url  = |{ ls_svc-path }/|.
          add( EXPORTING iv_parent = 'ODATA' iv_id = |ODATA-{ lv_name }| iv_kind = gc_kind-service
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name iv_url = lv_url
                         iv_detail = CONV string( ls_svc-handler_name ) iv_badge = 'ODATA'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'ICF'.
          lv_name = last_segment( CONV string( ls_svc-path ) ).
          add( EXPORTING iv_parent = 'ICF' iv_id = |ICF-{ lv_name }| iv_kind = gc_kind-service
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name iv_url = CONV string( ls_svc-path )
                         iv_detail = CONV string( ls_svc-handler_name ) iv_badge = 'ICF'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'APC'.
* a websocket has no page of its own; the node names the class that answers
          lv_name = last_segment( CONV string( ls_svc-path ) ).
          add( EXPORTING iv_parent = 'APC' iv_id = |APC-{ lv_name }| iv_kind = gc_kind-service
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name
                         iv_detail = CONV string( ls_svc-handler_name ) iv_badge = 'APC'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'APP'.
          lv_name = ls_svc-handler_name.
          TRANSLATE lv_name TO UPPER CASE.
          add( EXPORTING iv_parent = 'APPS' iv_id = |APP-{ lv_name }| iv_kind = gc_kind-app
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name iv_url = CONV string( ls_svc-path )
                         iv_detail = CONV string( ls_svc-handler_name ) iv_badge = 'APP'
               CHANGING  ct_nodes = rt_nodes ).
      ENDCASE.
    ENDSELECT.

    SELECT * FROM zosd_pack INTO ls_pack ORDER BY pack_order name.
      lv_name = ls_pack-name.
      TRANSLATE lv_name TO UPPER CASE.
      add( EXPORTING iv_parent = 'PACKS' iv_id = |PACK-{ lv_name }| iv_kind = gc_kind-service
                     iv_text = COND string( WHEN ls_pack-description IS INITIAL THEN lv_name ELSE ls_pack-description )
                     iv_name = lv_name
                     iv_url = '/app/flp.html#System-status'
                     iv_detail = |{ ls_pack-objects } objects| iv_badge = 'PACK'
           CHANGING  ct_nodes = rt_nodes ).
    ENDSELECT.

* The transactions of this system, out of the *.tran.xml objects of the
* layers through the generated registry (tools/osd-tran-registry.mjs). The
* detail is what SE93 would show and, for one that cannot be entered here,
* the reason -- a report, a dynpro, a class that is not in the tree.
    lt_tran = zcl_osd_tran_registry=>list( ).
    LOOP AT lt_tran INTO ls_tran.
      IF ls_tran-tcode = 'ZABAPGIT'.
* the seat below is the one this system types out; two would be two
        CONTINUE.
      ENDIF.
      add( EXPORTING iv_parent = 'TOOLS' iv_id = |TCODE-{ ls_tran-tcode }| iv_kind = gc_kind-transaction
                     iv_text = COND string( WHEN ls_tran-text IS INITIAL THEN ls_tran-tcode ELSE ls_tran-text )
                     iv_name = ls_tran-tcode
                     iv_url = COND string( WHEN ls_tran-runnable = abap_true
                                           THEN |{ gc_path }/?okcode={ ls_tran-tcode }| ELSE '' )
                     iv_detail = COND string( WHEN ls_tran-runnable = abap_true
                                              THEN |{ ls_tran-classname }| ELSE ls_tran-reason )
                     iv_badge = 'TCODE'
           CHANGING  ct_nodes = rt_nodes ).
    ENDLOOP.

* abapGit, the one transaction node this class types out, and the reason the
* kind existed before anything filled it. This tree carries no
* zabapgit.tran.xml -- the closure is a build decision rather than a screen
* (backlog G.4) -- so there is nothing for the registry to read, and the node
* says exactly that instead of pretending.
    add( EXPORTING iv_parent = 'TOOLS' iv_id = 'TOOLS-ZABAPGIT' iv_kind = gc_kind-transaction
                   iv_text = 'abapGit' iv_name = 'ZABAPGIT'
                   iv_detail = 'no zabapgit.tran.xml in this tree: backlog G.4'
                   iv_badge = 'TCODE'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'TOOLS' iv_id = 'TOOLS-SEGW' iv_kind = gc_kind-app
                   iv_text = 'Service Builder' iv_name = 'SEGW'
                   iv_url = '/app/flp.html#SegwProject-manage'
                   iv_detail = 'stg.segw' iv_badge = 'APP'
         CHANGING  ct_nodes = rt_nodes ).
    add( EXPORTING iv_parent = 'TOOLS' iv_id = 'TOOLS-STATUS' iv_kind = gc_kind-app
                   iv_text = 'System status' iv_name = 'SM50'
                   iv_url = '/app/flp.html#System-status'
                   iv_detail = 'stg.status' iv_badge = 'APP'
         CHANGING  ct_nodes = rt_nodes ).
  ENDMETHOD.

  METHOD resolve.
    DATA lt_nodes TYPE tt_node.
    DATA ls_node  TYPE ty_node.
    DATA lv_code  TYPE string.
    DATA lv_text  TYPE string.

    lv_code = iv_code.
    CONDENSE lv_code.
    TRANSLATE lv_code TO UPPER CASE.
* /n and /o in front of an ok-code are how SAP says "end this transaction
* first" and "start it in a new session"; neither means anything here, and
* both are part of the muscle memory, so both are taken off.
    IF strlen( lv_code ) > 2 AND ( lv_code(2) = '/N' OR lv_code(2) = '/O' ).
      lv_code = lv_code+2.
    ENDIF.
    IF lv_code IS INITIAL.
      RETURN.
    ENDIF.

    lt_nodes = menu( ).

    LOOP AT lt_nodes INTO ls_node.
      IF ls_node-kind <> gc_kind-folder AND ls_node-name = lv_code.
        rs_node = ls_node.
        RETURN.
      ENDIF.
    ENDLOOP.

* nothing by its technical name, so by the name it is called: a menu whose
* rows read "Travels" and "System status" should answer to those too
    LOOP AT lt_nodes INTO ls_node.
      lv_text = ls_node-text.
      TRANSLATE lv_text TO UPPER CASE.
      IF ls_node-kind <> gc_kind-folder AND lv_text = lv_code.
        rs_node = ls_node.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD has_children.
    DATA ls_node TYPE ty_node.
    LOOP AT it_nodes INTO ls_node.
      IF ls_node-parent = iv_id.
        rv_yes = abap_true.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD leaf.
    DATA lv_row TYPE string.

    lv_row = |<span class="ico ico-{ to_lower( is_node-badge ) }"></span>| &&
             |<span class="lbl">{ esc( is_node-text ) }</span>| &&
             |<span class="tech">{ esc( is_node-name ) }</span>| &&
             |<span class="det">{ esc( is_node-detail ) }</span>|.

    IF is_node-url IS INITIAL.
* A node with nothing to open is still a node: the push channels are real
* and have no page, and a menu that hid them would be lying about what the
* system serves.
      rv_html = |<div class="leaf dead" data-node="{ esc( is_node-name ) }" data-kind="{ esc( is_node-kind ) }">{ lv_row }</div>|.
    ELSE.
* target="_top" because the launchpad frames this screen behind a tile, and a
* node that opened a launchpad inside a launchpad would be a joke told twice.
* On the page itself _top is the page.
      rv_html = |<a class="leaf" target="_top" href="{ esc( is_node-url ) }" data-node="{ esc( is_node-name ) }" data-kind="{ esc( is_node-kind ) }">{ lv_row }</a>|.
    ENDIF.
  ENDMETHOD.

  METHOD branch.
    DATA ls_node TYPE ty_node.
    DATA lv_open TYPE string.

    LOOP AT it_nodes INTO ls_node.
      IF ls_node-parent <> iv_parent.
        CONTINUE.
      ENDIF.
      IF ls_node-kind = gc_kind-folder OR has_children( it_nodes = it_nodes iv_id = ls_node-id ) = abap_true.
* the first two levels stand open, the way SAP Easy Access opens the menu
* it was left on and leaves the rest folded
        lv_open = COND string( WHEN iv_level < 2 THEN ' open' ELSE '' ).
        rv_html = rv_html &&
          |<details class="fld"{ lv_open }><summary data-node="{ esc( ls_node-name ) }">| &&
          |<span class="ico ico-folder"></span><span class="lbl">{ esc( ls_node-text ) }</span></summary>| &&
          |<div class="kids">| &&
          branch( it_nodes = it_nodes iv_parent = ls_node-id iv_level = iv_level + 1 ) &&
          |</div></details>|.
      ELSE.
        rv_html = rv_html && leaf( ls_node ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD artwork.
* The tall panel down the right-hand side, the bulge in it, and the drop.
*
* On a real SAP Easy Access screen this is a picture control showing whatever
* SMW0 object the system was configured with, and its left edge curves into
* the menu. It is drawn here rather than loaded, so the screen needs no
* object and no second request: one path, curved out to the left in the
* middle, filled with the gradient, and the wordmark laid over it in HTML so
* that stretching the panel does not stretch the letters.
*
* There was a single glossy bead here, set on a diagonal - a nod to the drop
* of the original rather than a copy of it. It is gone (Alice, 2026-09-18):
* once the panel became rain on a surface, with drops striking it and rings
* spreading, one oversized bead beside the wordmark was the one object in the
* picture that was not part of the scene. The rings are the drops now.
    rv_html =
      `<div class="art">` &&
      `<svg class="artbg" viewBox="0 0 300 900" preserveAspectRatio="none" aria-hidden="true">` &&
      `<defs>` &&
      `<linearGradient id="ag" x1="0" y1="0" x2="0.6" y2="1">` &&
      `<stop offset="0" stop-color="#4a86c8"/><stop offset="0.45" stop-color="#1d4f8a"/><stop offset="1" stop-color="#0b2544"/>` &&
      `</linearGradient>` &&
      `<linearGradient id="ah" x1="0" y1="0" x2="1" y2="0">` &&
      `<stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>` &&
      `</linearGradient>` &&
      `</defs>` &&
      `<path d="M118,0 C22,230 22,670 118,900 L300,900 L300,0 Z" fill="url(#ag)"/>` &&
      `<path d="M118,0 C22,230 22,670 118,900 L300,900 L300,0 Z" fill="url(#ah)"/>` &&
      `<path d="M118,0 C22,230 22,670 118,900" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>` &&
      `</svg>` &&
* Backlog G.1c. The original is a pool seen from above with concentric
* ripples and words half-submerged in it, so this is that: a rainbow in pastel
* over a still surface, and rings spreading where drops fell -- the drops
* themselves left out, because the rings are what says a drop was there.
*
* **Still on purpose** (Alice, 2026-09-18). There is no animation in it at
* all: no <animate>, no <animateTransform>. A screen somebody works on all day
* should not move.
*
* It is a second SVG rather than more of the panel because the two want
* different things from the panel's shape. It STRETCHES with the panel
* (preserveAspectRatio=none), the way the picture on the real screen does:
* pull the splitter and the water is pulled with it, rings and all, instead
* of the scene being scaled and cropped so that most of it leaves the frame
* (Alice, 2026-09-18 -- "stretch like SAP, do not scale"). Rings becoming
* ellipses is what stretching water looks like, and the bead that could not
* survive it is gone anyway.
      `<svg class="artscene" viewBox="0 0 320 480" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">` &&
      `<stop offset="0" stop-color="#4a86c8" stop-opacity="0.55"/><stop offset="1" stop-color="#071b33" stop-opacity="0.9"/></linearGradient>` &&
      `<radialGradient id="gl" cx="0.5" cy="1" r="0.75"><stop offset="0" stop-color="#eaf4ff" stop-opacity="0.22"/><stop offset="1" stop-color="#eaf4ff" stop-opacity="0"/>` &&
      `</radialGradient><clipPath id="sky"><rect x="0" y="0" width="320" height="252"/></clipPath></defs><ellipse cx="160" cy="252" rx="200" ry="150" fill="url(#gl)"/>` &&
      `<g clip-path="url(#sky)"><path d="M8,252 A152,152 0 0 1 312,252" fill="none" stroke="#f7b9ae" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M17,252 A143,143 0 0 1 303,252" fill="none" stroke="#f8d0a8" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M26,252 A134,134 0 0 1 294,252" fill="none" stroke="#f7ecb2" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M35,252 A125,125 0 0 1 285,252" fill="none" stroke="#c2e6bd" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M44,252 A116,116 0 0 1 276,252" fill="none" stroke="#b4dcef" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M53,252 A107,107 0 0 1 267,252" fill="none" stroke="#b9c2ee" stroke-opacity="0.72" stroke-width="9"/>` &&
      `<path d="M62,252 A98,98 0 0 1 258,252" fill="none" stroke="#d6bee8" stroke-opacity="0.72" stroke-width="9"/></g>` &&
      `<rect x="0" y="252" width="320" height="228" fill="url(#wg)"/><line x1="0" y1="252" x2="320" y2="252" stroke="#eaf4ff" stroke-opacity="0.45" stroke-width="1.5"/>` &&
      `<clipPath id="sea"><rect x="0" y="252" width="320" height="228"/></clipPath>` &&
      `<linearGradient id="rf" x1="0" y1="252" x2="0" y2="356" gradientUnits="userSpaceOnUse">` &&
      `<stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` &&
      `<mask id="rm"><rect x="0" y="252" width="320" height="120" fill="url(#rf)"/>` &&
      `<rect x="0" y="254.0" width="320" height="1.6" fill="#000000" fill-opacity="0.85"/>` &&
      `<rect x="0" y="258.4" width="320" height="2.1" fill="#000000" fill-opacity="0.83"/>` &&
      `<rect x="0" y="263.5" width="320" height="2.6" fill="#000000" fill-opacity="0.81"/>` &&
      `<rect x="0" y="269.3" width="320" height="1.6" fill="#000000" fill-opacity="0.79"/>` &&
      `<rect x="0" y="275.8" width="320" height="2.1" fill="#000000" fill-opacity="0.77"/>` &&
      `<rect x="0" y="280.2" width="320" height="2.6" fill="#000000" fill-opacity="0.75"/>` &&
      `<rect x="0" y="285.3" width="320" height="1.6" fill="#000000" fill-opacity="0.73"/>` &&
      `<rect x="0" y="291.1" width="320" height="2.1" fill="#000000" fill-opacity="0.71"/>` &&
      `<rect x="0" y="297.6" width="320" height="2.6" fill="#000000" fill-opacity="0.69"/>` &&
      `<rect x="0" y="302.0" width="320" height="1.6" fill="#000000" fill-opacity="0.67"/>` &&
      `<rect x="0" y="307.1" width="320" height="2.1" fill="#000000" fill-opacity="0.65"/>` &&
      `<rect x="0" y="312.9" width="320" height="2.6" fill="#000000" fill-opacity="0.63"/>` &&
      `<rect x="0" y="319.4" width="320" height="1.6" fill="#000000" fill-opacity="0.61"/>` &&
      `<rect x="0" y="323.8" width="320" height="2.1" fill="#000000" fill-opacity="0.59"/>` &&
      `<rect x="0" y="328.9" width="320" height="2.6" fill="#000000" fill-opacity="0.57"/>` &&
      `<rect x="0" y="334.7" width="320" height="1.6" fill="#000000" fill-opacity="0.55"/>` &&
      `<rect x="0" y="341.2" width="320" height="2.1" fill="#000000" fill-opacity="0.53"/>` &&
      `<rect x="0" y="345.6" width="320" height="2.6" fill="#000000" fill-opacity="0.51"/>` &&
      `<rect x="0" y="350.7" width="320" height="1.6" fill="#000000" fill-opacity="0.5"/>` &&
      `</mask>` &&
* The rainbow, again, upside down in the water and squashed the way a
* reflection is, broken into dashes because still water would mirror and
* rippled water only suggests -- and the dashes are horizontal bands cut out
* of the mask rather than a dash pattern along each arc, because a dash
* following a curve reads as brickwork and a horizontal band reads as the
* surface. Clipped to the sea so it cannot climb back
* into the sky, and faded out downwards through a mask, which is what stops
* it looking like brickwork: a reflection is strongest where the thing
* touches the water and gone a little further out. Ghostly was the word
* (Alice, 2026-09-18), so it is meant to be noticed second.
* The clip and the flip cannot ride on the same element: an element's own
* transform applies to its clip path too, so clipping to the sea and then
* mirroring turned the clip upside down as well and the reflection was cut
* to the sky, where it is not. It rendered, it measured 448 by 165 in the
* right place, and it was invisible - found by looking at the pixels, not
* by reading the markup. So the clip is on the outer group and the mirror
* on the inner one.
      `<g clip-path="url(#sea)" mask="url(#rm)"><g transform="translate(0,408.2) scale(1,-0.62)">` &&
      `<path d="M8,252 A152,152 0 0 1 312,252" fill="none" stroke="#f7b9ae" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M17,252 A143,143 0 0 1 303,252" fill="none" stroke="#f8d0a8" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M26,252 A134,134 0 0 1 294,252" fill="none" stroke="#f7ecb2" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M35,252 A125,125 0 0 1 285,252" fill="none" stroke="#c2e6bd" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M44,252 A116,116 0 0 1 276,252" fill="none" stroke="#b4dcef" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M53,252 A107,107 0 0 1 267,252" fill="none" stroke="#b9c2ee" stroke-opacity="0.55" stroke-width="9"/>` &&
      `<path d="M62,252 A98,98 0 0 1 258,252" fill="none" stroke="#d6bee8" stroke-opacity="0.55" stroke-width="9"/>` &&
      `</g></g>` &&
      `<ellipse cx="74" cy="372" rx="15" ry="4.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="74" cy="372" rx="30" ry="9.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="74" cy="372" rx="45" ry="13.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="60" ry="18.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="75" ry="22.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="90" ry="27.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.15" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="105" ry="31.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.105" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="120" ry="36.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.06" stroke-width="1.1"/>` &&
      `<ellipse cx="74" cy="372" rx="135" ry="40.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.06" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="17" ry="5.1" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="196" cy="404" rx="34" ry="10.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="196" cy="404" rx="51" ry="15.3" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="68" ry="20.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="85" ry="25.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="102" ry="30.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.15" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="119" ry="35.7" fill="none" stroke="#eaf4ff" stroke-opacity="0.105" stroke-width="1.1"/>` &&
      `<ellipse cx="196" cy="404" rx="136" ry="40.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.06" stroke-width="1.1"/>` &&
      `<ellipse cx="132" cy="452" rx="21" ry="6.3" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="132" cy="452" rx="42" ry="12.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="132" cy="452" rx="63" ry="18.9" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="132" cy="452" rx="84" ry="25.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="132" cy="452" rx="105" ry="31.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="132" cy="452" rx="126" ry="37.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.15" stroke-width="1.1"/>` &&
      `<ellipse cx="132" cy="452" rx="147" ry="44.1" fill="none" stroke="#eaf4ff" stroke-opacity="0.105" stroke-width="1.1"/>` &&
      `<ellipse cx="262" cy="350" rx="13" ry="3.9" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="262" cy="350" rx="26" ry="7.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="262" cy="350" rx="39" ry="11.7" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="262" cy="350" rx="52" ry="15.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="262" cy="350" rx="65" ry="19.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="262" cy="350" rx="78" ry="23.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.15" stroke-width="1.1"/>` &&
      `<ellipse cx="40" cy="436" rx="19" ry="5.7" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="40" cy="436" rx="38" ry="11.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="40" cy="436" rx="57" ry="17.1" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="40" cy="436" rx="76" ry="22.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="40" cy="436" rx="95" ry="28.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="228" cy="468" rx="23" ry="6.9" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="228" cy="468" rx="46" ry="13.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="228" cy="468" rx="69" ry="20.7" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="228" cy="468" rx="92" ry="27.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="228" cy="468" rx="115" ry="34.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="300" cy="330" rx="11" ry="3.3" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="300" cy="330" rx="22" ry="6.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="300" cy="330" rx="33" ry="9.9" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="300" cy="330" rx="44" ry="13.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="300" cy="330" rx="55" ry="16.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="108" cy="412" rx="9" ry="2.7" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="108" cy="412" rx="18" ry="5.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="108" cy="412" rx="27" ry="8.1" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="108" cy="412" rx="36" ry="10.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="176" cy="300" rx="7" ry="2.1" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="176" cy="300" rx="14" ry="4.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="176" cy="300" rx="21" ry="6.3" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="52" cy="330" rx="8" ry="2.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="52" cy="330" rx="16" ry="4.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="52" cy="330" rx="24" ry="7.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="52" cy="330" rx="32" ry="9.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="246" cy="430" rx="15" ry="4.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="246" cy="430" rx="30" ry="9.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="246" cy="430" rx="45" ry="13.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="246" cy="430" rx="60" ry="18.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="246" cy="430" rx="75" ry="22.5" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="150" cy="348" rx="12" ry="3.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="150" cy="348" rx="24" ry="7.2" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="150" cy="348" rx="36" ry="10.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="150" cy="348" rx="48" ry="14.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="150" cy="348" rx="60" ry="18.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.195" stroke-width="1.1"/>` &&
      `<ellipse cx="296" cy="470" rx="10" ry="3.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="296" cy="470" rx="20" ry="6.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="296" cy="470" rx="30" ry="9.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `<ellipse cx="296" cy="470" rx="40" ry="12.0" fill="none" stroke="#eaf4ff" stroke-opacity="0.24" stroke-width="1.1"/>` &&
      `<ellipse cx="16" cy="380" rx="6" ry="1.8" fill="none" stroke="#eaf4ff" stroke-opacity="0.375" stroke-width="1.4"/>` &&
      `<ellipse cx="16" cy="380" rx="12" ry="3.6" fill="none" stroke="#eaf4ff" stroke-opacity="0.33" stroke-width="1.4"/>` &&
      `<ellipse cx="16" cy="380" rx="18" ry="5.4" fill="none" stroke="#eaf4ff" stroke-opacity="0.285" stroke-width="1.1"/>` &&
      `</svg>` &&
      `<div class="artmark">` &&
      `<div class="artname">Open<b>SteamGate</b></div>` &&
      |<div class="artsid">{ esc( iv_sid ) }</div>| &&
      `<div class="artnote">the next level of vaporware</div>` &&
      `</div></div>`.
  ENDMETHOD.

  METHOD identity.
* The four identities of backlog G.1b are one now. sy is what the ABAP in
* this process actually sees -- the boot sets sy-sysid, sy-mandt and
* sy-uname from tools/osd-identity.mjs, which is also where the status
* snapshot takes ZOSD_SYS-SID and the ADT facade takes what it tells
* Eclipse -- and PID is the process those tables were written in. Nothing
* below is a literal, and there is no session number, because this system
* has no sessions: it has work processes, so the work process is what goes
* where SAP GUI prints the session.
    DATA ls_sys TYPE zosd_sys.

    rs_ident-sid    = sy-sysid.
    rs_ident-client = sy-mandt.
    rs_ident-user   = sy-uname.
    CONDENSE rs_ident-sid.
    CONDENSE rs_ident-client.
    CONDENSE rs_ident-user.

    SELECT SINGLE * FROM zosd_sys INTO ls_sys.
    rs_ident-host_kind = ls_sys-host_kind.
    CONDENSE rs_ident-host_kind.
    IF ls_sys-pid > 0.
      rs_ident-pid = |{ ls_sys-pid }|.
    ENDIF.

    IF rs_ident-pid IS INITIAL.
* a deployment with no process number -- the browser one -- says nothing
* rather than printing a zero that looks like a session
      rs_ident-info = |{ rs_ident-sid } { rs_ident-client } { rs_ident-user }|.
    ELSE.
      rs_ident-info = |{ rs_ident-sid } ({ rs_ident-pid }) { rs_ident-client } { rs_ident-user }|.
    ENDIF.
  ENDMETHOD.

  METHOD target.
    DATA ls_node TYPE ty_node.
    LOOP AT it_nodes INTO ls_node.
      IF ls_node-name = iv_name.
        rv_url = ls_node-url.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD menu_item.
    IF iv_url IS INITIAL.
      rv_html = |<span class="mx off" aria-disabled="true" title="not wired to anything">{ esc( iv_text ) }</span>|.
    ELSE.
      rv_html = |<a class="mx" target="_top" href="{ esc( iv_url ) }">{ esc( iv_text ) }</a>|.
    ENDIF.
  ENDMETHOD.

  METHOD menu_entry.
    DATA lv_class TYPE string.
    lv_class = COND string( WHEN iv_live = abap_true THEN 'mt' ELSE 'mt off' ).
    rv_html = |<div class="mi"><span class="{ lv_class }" tabindex="0">{ esc( iv_text ) }</span>| &&
              |<div class="drop">{ iv_items }</div></div>|.
  ENDMETHOD.

  METHOD menubar.
* The bar of the classic screen, and every live entry in it is a plain
* anchor: no JavaScript, the fold-out is :hover and :focus-within in CSS.
*
* Where the live ones point is read out of the node list rather than typed
* here a second time -- System > Status is the target of the node the tree
* shows as "System status", System > Log off is the launchpad node -- so a
* target that moves moves in both places at once. Everything else is greyed:
* the screen has one function, and a menu that quietly swallowed a click
* would be worse than one that admits what it cannot do.
    DATA lv_favs TYPE string.
    DATA ls_node TYPE ty_node.
    DATA lv_url  TYPE string.

    LOOP AT it_nodes INTO ls_node.
      IF ls_node-parent <> 'FAVORITES'.
        CONTINUE.
      ENDIF.
* a favourite with no page of its own is still reachable: the command field
* answers for it, and says what it is
      lv_url = COND string( WHEN ls_node-url IS INITIAL
                            THEN |{ gc_path }/?okcode={ ls_node-name }|
                            ELSE ls_node-url ).
      lv_favs = lv_favs && menu_item( iv_text = ls_node-text iv_url = lv_url ).
    ENDLOOP.

    rv_html =
      menu_entry( iv_text  = 'Menu'
                  iv_items = menu_item( 'Create role' ) && menu_item( 'Assign users' ) && menu_item( 'Documentation' ) ) &&
      menu_entry( iv_text  = 'Edit'
                  iv_items = menu_item( 'Expand' ) && menu_item( 'Collapse' ) && menu_item( 'Create favourite' ) ) &&
      menu_entry( iv_text  = 'Favorites'
                  iv_live  = abap_true
                  iv_items = lv_favs ) &&
      menu_entry( iv_text  = 'Extras'
                  iv_items = menu_item( 'Settings' ) && menu_item( 'Technical information' ) ) &&
      menu_entry( iv_text  = 'System'
                  iv_live  = abap_true
                  iv_items = menu_item( iv_text = 'Status' iv_url = target( it_nodes = it_nodes iv_name = 'SM50' ) ) &&
                             menu_item( 'Create session' ) &&
                             menu_item( 'User profile' ) &&
                             menu_item( iv_text = 'Log off' iv_url = target( it_nodes = it_nodes iv_name = 'FLP' ) ) ) &&
      menu_entry( iv_text  = 'Help'
                  iv_live  = abap_true
                  iv_items = menu_item( iv_text = 'About' iv_url = |{ gc_path }/about| ) &&
                             menu_item( 'SAP Library' ) &&
                             menu_item( 'Release notes' ) ).
  ENDMETHOD.

  METHOD about_row.
    rv_html = |<tr><th>{ esc( iv_label ) }</th><td>{ esc( iv_value ) }</td></tr>|.
  ENDMETHOD.

  METHOD about.
* Help > About, at /sap/bc/gui/sap/its/webgui/about.
*
* The generation, the build and what this system is -- and every line of it
* is read rather than written down: sy for the identity, ZOSD_SYS for the
* generation and the process, the menu for the size of the tree.
    DATA ls_sys   TYPE zosd_sys.
    DATA ls_ident TYPE ty_ident.
    DATA lv_rel   TYPE string.

    ls_ident = identity( ).
    SELECT SINGLE * FROM zosd_sys INTO ls_sys.
    lv_rel = sy-saprl.
    CONDENSE lv_rel.

    rv_html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width,initial-scale=1">` &&
      `<link rel="icon" type="image/svg+xml" href="/app/osg.svg"><title>About - open-steamgate</title><style>` && style( ) && `</style></head><body>` &&
      `<div class="win">` &&
      |<div class="title"><span>System: Status</span><small>{ esc( ls_ident-info ) }</small></div>| &&
      `<div class="about">` &&
      `<h1>open-steamgate</h1>` &&
      `<p>A local IWBEP / OData runtime: the ABAP of this tree, transpiled to JavaScript, ` &&
      `Open SQL over SQLite, ICF services behind CL_EXPRESS_ICF_SHIM, and Fiori on top. ` &&
      `This screen is ZCL_OSD_WEBGUI, mounted where the real ITS webgui answers on a system.</p>` &&
      `<table class="kv">` &&
      about_row( iv_label = 'System (sy-sysid)'   iv_value = ls_ident-sid ) &&
      about_row( iv_label = 'Client (sy-mandt)'   iv_value = ls_ident-client ) &&
      about_row( iv_label = 'User (sy-uname)'     iv_value = ls_ident-user ) &&
      about_row( iv_label = 'Release (sy-saprl)'  iv_value = lv_rel ) &&
      about_row( iv_label = 'Work process'        iv_value = COND string( WHEN ls_ident-pid IS INITIAL THEN 'none: this deployment has no process number' ELSE ls_ident-pid ) ) &&
      about_row( iv_label = 'Host'                iv_value = ls_ident-host_kind ) &&
      about_row( iv_label = 'Work processes'      iv_value = |{ ls_sys-workers }| ) &&
      about_row( iv_label = 'Generation built'    iv_value = CONV string( ls_sys-gen_live ) ) &&
      about_row( iv_label = 'Generation serving'  iv_value = CONV string( ls_sys-gen_serving ) ) &&
      about_row( iv_label = 'In step'             iv_value = COND string( WHEN ls_sys-synced = 'X' THEN 'yes' ELSE 'no' ) ) &&
      about_row( iv_label = 'Started'             iv_value = CONV string( ls_sys-started_at ) ) &&
      about_row( iv_label = 'Snapshot taken'      iv_value = CONV string( ls_sys-snap_at ) ) &&
      about_row( iv_label = 'Tree'                iv_value = CONV string( ls_sys-root_hint ) ) &&
      about_row( iv_label = 'Menu'                iv_value = |{ lines( menu( ) ) } nodes, from the system status tables| ) &&
      `</table>` &&
      `<p class="dim">The identity is one setting at boot (tools/osd-identity.mjs): it sets sy-sysid, ` &&
      `sy-mandt and sy-uname, names the system in the status tables, and is what the ADT facade ` &&
      `presents to Eclipse. docs/webgui.md says why the facade's own id is allowed to differ.</p>` &&
      |<p><a class="back" href="{ gc_path }/">Back to Easy Success</a></p>| &&
      `</div></div></body></html>`.
  ENDMETHOD.

  METHOD drag_script.
* Dragging the boundary, and the reason this screen now carries a script
* after refusing to for a week.
*
* A browser draws the only handle it has in one corner of the resizable
* element, sixteen pixels of it, and there is no way to stretch that handle
* down the whole boundary. The CSS steps below it are real - four widths as
* radio buttons, a click on the ridge moves to the next - but the gesture
* everybody makes over a col-resize cursor is a PULL, and Alice made it
* three times before saying so. A cursor that promises dragging over
* something that cannot be dragged is the same lie as a button that looks
* enabled and does nothing, which this screen refuses to tell anywhere else.
*
* So: the page still works with the script removed. Without it the ridge
* steps on a click and the picture still hides, because all of that is CSS
* and an anchor; the script only adds the pull. That is why the browser
* test no longer asserts a script count of zero, and asserts instead that
* every function of the screen survives scripting being switched off.
*
* An inline width beats the stepped widths, since a rule keyed on a checked
* radio cannot outrank a style attribute - so once it is pulled, it stays
* where it was put.
    rv_html =
      `<script>(function(){` &&
      `var s=document.querySelector('.split'),t=document.querySelector('.tree');` &&
      `if(!s||!t){return;}` &&
      `var on=false,moved=false,x0=0,w0=0;` &&
* Three obvious things here are wrong, and all three were found by measuring
* rather than by reading - the whole method is four statements long and it
* took three rounds.
*
* preventDefault() on pointerdown eats the click that follows, and with it
* the stepping the ridge does for somebody who clicks instead of pulling.
* setPointerCapture on pointerdown does the same damage by another route: a
* captured pointer delivers its click to the capturing element, so the label
* lying over the ridge never receives it and the width never changes. Both
* times the script was quietly taking away a function the page already had
* without it.
*
* And the fix for the second one broke the first: with no capture at all,
* the pointer leaves the eight-pixel ridge on the first millimetre of a pull
* and every later move goes to whatever is under the cursor. So the move and
* the release are listened for on the window, where they arrive wherever the
* pointer has wandered to, and only the press is the ridge's own. Nothing is
* prevented, nothing is captured, and a click is still a click.
*
* Selection is held off with user-select during a drag and put back on
* release.
      `s.addEventListener('pointerdown',function(e){` &&
      `on=true;moved=false;x0=e.clientX;w0=t.getBoundingClientRect().width;` &&
      `document.body.style.userSelect='none';});` &&
      `window.addEventListener('pointermove',function(e){` &&
      `if(!on){return;}var d=e.clientX-x0;if(d>3||d<-3){moved=true;}` &&
      `var w=w0+d,lo=220,hi=window.innerWidth-140;` &&
      `if(w<lo){w=lo;}if(w>hi){w=hi;}` &&
      `t.style.width=w+'px';t.style.maxWidth='none';});` &&
      `window.addEventListener('pointerup',function(){on=false;` &&
      `document.body.style.userSelect='';});` &&
* a pull that ends over the ridge would otherwise also count as a click on
* the label lying over it, and the boundary would jump to the next step
* just as it was let go
      `s.addEventListener('click',function(e){` &&
      `if(moved){e.preventDefault();e.stopPropagation();}},true);` &&
*
* The arrow keys, because a tree that can only be walked with Tab is not a
* tree. `<details>` gives Enter and Space for free and nothing else: Tab
* reaches every row, including the ones inside a folded folder in some
* browsers, and neither Up/Down nor Left/Right mean anything. This is the
* ordinary treeview behaviour and it has to be written.
*
* Visibility is read off the `open` attribute of the ancestors, and the
* first version read it off `offsetParent` on exactly the argument that
* sounds better: the browser has already computed it, so why ask twice.
* Measured -- the folder closed, `open` went false, and the count of
* "visible" rows did not move. Chromium hides a folded `<details>` with
* `content-visibility`, which skips painting and **keeps the layout box**,
* so `offsetParent` stays non-null. The instrument was accurate and
* answered a different question: it says "has a box", not "is on screen".
*
* A summary starts the search one level up, above its own `<details>`,
* because the summary of a folded folder is visible and its siblings are
* not.
*
* Left on a leaf or on a closed folder goes to the **parent**, which is the
* part people miss when they write this from the keys rather than from the
* shape: the key is not "close", it is "out".
*
* And the parent is not one expression. For a leaf it is the folder the leaf
* is in; for a closed folder it is the folder **above** that one. Written as
* a single climb it silently does the right thing for a summary and nothing
* at all for a leaf -- which is what it did, measured by pressing the key
* rather than by reading it back.
      `var tr=document.querySelector('.tree');if(tr){` &&
      `var items=function(){` &&
      `return [].slice.call(tr.querySelectorAll('summary,a.leaf'))` &&
      `.filter(function(n){var d=n.tagName==='SUMMARY'?n.parentNode.parentNode:n;` &&
      `return !d||!d.closest||!d.closest('details.fld:not([open])');});};` &&
      `var owner=function(n){` &&
      `return n.tagName==='SUMMARY'?n.parentNode:n.closest('details.fld');};` &&
      `tr.addEventListener('keydown',function(e){` &&
      `var a=document.activeElement;` &&
      `if(!a||!tr.contains(a)){return;}` &&
      `var k=e.key,l=items(),i=l.indexOf(a);if(i<0){return;}` &&
      `var go=function(n){if(n){n.focus();e.preventDefault();}};` &&
      `if(k==='ArrowDown'){go(l[i+1]);return;}` &&
      `if(k==='ArrowUp'){go(l[i-1]);return;}` &&
      `if(k==='ArrowRight'){` &&
      `if(a.tagName!=='SUMMARY'){return;}` &&
      `var d=a.parentNode;` &&
      `if(!d.open){d.open=true;e.preventDefault();return;}` &&
      `go(l[i+1]);return;}` &&
      `if(k==='ArrowLeft'){` &&
      `if(a.tagName==='SUMMARY'&&a.parentNode.open){` &&
      `a.parentNode.open=false;e.preventDefault();return;}` &&
      `var d=owner(a),up=a.tagName==='SUMMARY'` &&
      `?(d&&d.parentNode&&d.parentNode.closest?d.parentNode.closest('details.fld'):null)` &&
      `:d;` &&
      `go(up&&up.querySelector('summary'));return;}` &&
      `if(k==='Home'){go(l[0]);return;}` &&
      `if(k==='End'){go(l[l.length-1]);}});}` &&
      `})();</script>`.
  ENDMETHOD.

  METHOD style.
    rv_css =
      `*{box-sizing:border-box}` &&
      `html,body{height:100%;margin:0}` &&
      `body{background:#d7dfe8;color:#1c2f43;font:13px "72","Segoe UI",Arial,sans-serif}` &&
      `.win{height:100%;display:flex;flex-direction:column;background:#eef3f8}` &&
      `.title{background:linear-gradient(#5d8ac0,#2f5f94);color:#fff;font-weight:bold;padding:6px 12px;letter-spacing:.3px;` &&
      `display:flex;justify-content:space-between;align-items:center}` &&
      `.title small{font-weight:normal;opacity:.9}` &&
      `.menu{background:#eef2f7;border-bottom:1px solid #c5d0dd;padding:2px 6px;color:#2b3b4d;` &&
      `display:flex;gap:2px;position:relative;z-index:20}` &&
* the fold-out is CSS, not script: open on hover, open on keyboard focus,
* and an item is an anchor or is visibly disabled
      `.mi{position:relative}` &&
      `.mt{display:inline-block;padding:3px 10px;border-radius:2px;cursor:default;outline-offset:-2px}` &&
      `.mi:hover>.mt,.mi:focus-within>.mt{background:#cfdcea}` &&
      `.mt.off{color:#8496a8}` &&
      `.drop{display:none;position:absolute;left:0;top:100%;min-width:190px;background:#fff;` &&
      `border:1px solid #8ea3bc;box-shadow:0 5px 12px rgba(12,34,58,.28);padding:3px 0;z-index:30}` &&
      `.mi:hover>.drop,.mi:focus-within>.drop{display:block}` &&
      `.mx{display:block;padding:4px 16px;white-space:nowrap;text-decoration:none;color:#1c2f43}` &&
      `a.mx:hover,a.mx:focus{background:#2668a3;color:#fff}` &&
      `.mx.off{color:#9aa9ba;cursor:default}` &&
      `.tools{background:linear-gradient(#f9fbfd,#e2e9f1);border-bottom:1px solid #b9c6d6;padding:5px 10px;` &&
      `display:flex;align-items:center;gap:8px}` &&
      `.cmdbox{display:flex;align-items:center;gap:4px}` &&
      `.cmd{width:210px;border:1px solid #7f93ab;border-top-color:#5d7186;padding:3px 6px;font:13px "72","Segoe UI",Arial,sans-serif;` &&
      `background:#fff;color:#1c2f43}` &&
      `.cmd:focus{outline:2px solid #2668a3;outline-offset:0}` &&
      `.btn{background:linear-gradient(#ffffff,#dde5ee);border:1px solid #8ea3bc;border-radius:3px;padding:3px 9px;` &&
      `font:13px "72","Segoe UI",Arial,sans-serif;color:#1c2f43;cursor:pointer}` &&
      `.btn:hover{background:linear-gradient(#ffffff,#cbd8e6)}` &&
      `.go{color:#1a7a3c;font-weight:bold}` &&
      `.ghost{color:#8496a8;padding:3px 7px}` &&
      `.ghost:disabled{cursor:default;background:linear-gradient(#f8fafc,#e8eef5)}` &&
      `.sep{width:1px;height:18px;background:#b9c6d6;margin:0 4px}` &&
      `.dim{color:#5d7186}` &&
      `.body{flex:1;display:flex;min-height:0}` &&
* The splitter, and it is a CSS one: `resize: horizontal` on the tree pane,
* so the grip in its bottom-right corner drags the boundary between the tree
* and the image and the screen still ships no JavaScript. The pane does not
* grow or shrink on its own (flex:0 0 auto), so the width the drag writes is
* the width that is used; the image panel takes whatever is left.
*
* It worked and nobody could find it, which is the same as not working. A
* browser draws that grip 16x16 in the pane's bottom-right corner only -- down
* by the node count -- and no standard property stretches it up the edge. So
* the boundary is drawn instead: a ridge with a notch, cursor col-resize, and
* the title that says where to pull. In Blink the system grip itself is sized
* off the scrollbar metrics, so widening the pane's scrollbar widens the grip
* and `::-webkit-resizer` colours it; elsewhere the small native one stays,
* next to a ridge that at least shows where it is.
      `.tree{flex:0 0 auto;width:68%;min-width:220px;max-width:calc(100% - 140px);` &&
      `overflow:auto;resize:horizontal;padding:10px 6px 26px 14px;background:#f7fafd}` &&
      `.tree::-webkit-scrollbar{width:14px;height:14px}` &&
      `.tree::-webkit-scrollbar-track{background:#eef3f9}` &&
      `.tree::-webkit-scrollbar-thumb{background:#c3d0de;border:3px solid #eef3f9;border-radius:7px}` &&
      `.tree::-webkit-resizer{background:#b9c6d6}` &&
* The ridge, and the one thing a person actually wants when they pull it.
* Eight pixels of drawn boundary with a notch in the middle, and a button at
* the top that hides the picture outright -- which is what most of that
* pulling is for. No script: the button is a link to an anchor that sits
* before the panes, and `:target` does the rest, so the state survives a
* reload and can be sent to somebody as a URL.
*
* The ridge also MOVES when it is clicked, and that is not decoration. A
* browser's own `resize` puts its grip in one corner, sixteen pixels of it,
* and nobody finds it; a ridge that shows a col-resize cursor and does
* nothing is the same lie as a button that looks enabled and is not, which
* this screen refuses to tell anywhere else. So there are four widths as
* radio buttons before the panes, and the label lying over the ridge points
* at the next one: a click steps the boundary and wraps around at the end.
* Dragging the corner grip still works and still wins, because the width it
* writes is an inline style.
      `.wsel{display:none}` &&
      `#w2:checked~.body .tree{width:50%}` &&
      `#w3:checked~.body .tree{width:34%}` &&
      `#w4:checked~.body .tree{width:84%}` &&
      `.wstep{display:none;position:absolute;inset:0;cursor:col-resize}` &&
      `#w1:checked~.body .to2{display:block}` &&
      `#w2:checked~.body .to3{display:block}` &&
      `#w3:checked~.body .to4{display:block}` &&
      `#w4:checked~.body .to1{display:block}` &&
      `.split{flex:0 0 8px;position:relative;cursor:col-resize;` &&
      `background:linear-gradient(90deg,#d7e2ee,#eef3f9 45%,#eef3f9 55%,#c3d0de)}` &&
      `.split::after{content:"";position:absolute;left:2px;top:50%;width:4px;height:46px;` &&
      `margin-top:-23px;border-left:1px solid #90a4b8;border-right:1px solid #90a4b8;opacity:.7}` &&
      `.splitbtn{position:absolute;left:-6px;top:8px;width:20px;height:18px;line-height:17px;` &&
      `text-align:center;text-decoration:none;color:#3c5670;border:1px solid #b9c6d6;border-radius:2px;` &&
      `background:linear-gradient(#ffffff,#dfe8f2);font-size:11px;cursor:pointer}` &&
      `.splitbtn:hover{background:linear-gradient(#ffffff,#cbd8e6)}` &&
      `.splitshow{display:none}` &&
      `#nopic:target~.body .art{display:none}` &&
      `#nopic:target~.body .tree{width:100%;max-width:none;resize:none}` &&
      `#nopic:target~.body .splithide{display:none}` &&
      `#nopic:target~.body .splitshow{display:block}` &&
      `.fld{margin:0}` &&
      `.fld>summary{list-style:none;cursor:pointer;padding:2px 4px;display:flex;align-items:center;gap:6px;border-radius:2px}` &&
      `.fld>summary::-webkit-details-marker{display:none}` &&
      `.fld>summary::before{content:"\25B6";color:#5d7186;font-size:9px;width:10px;display:inline-block}` &&
      `.fld[open]>summary::before{content:"\25BC"}` &&
      `.fld>summary:hover{background:#dbe7f4}` &&
*     Nesting the way SAP Easy Access draws it -- the **step**, measured off
*     three screenshots of the real screen, in our own hue (2026-09-19).
*
*     What was measured there: each level keeps about 0.6 of the previous
*     level's distance to white (0.63/0.57/0.62, then 0.5/0.25/0.5), the
*     indent is 18px = the row height, and the rule is horizontal and sits on
*     the subtree, which is why the original shows a line where a level
*     begins and ends and none between siblings. A horizontal scan confirmed
*     the background never changes with x, so what reads as a vertical band
*     of a level is not one.
*
*     What is **not** taken from there is the colour. The first version
*     transplanted SAP's greens into a blue screen, which is copying the
*     answer instead of the rule. The ladder is counted from this screen's
*     own base tone, #eaf4ff -- the tint it already uses everywhere -- by the
*     measured ratio, so the hue is ours and the rhythm is the original's.
*
*     `color-mix` states the derivation instead of hiding it in four hex
*     literals: 60%, 36%, 22% are 0.6, 0.6^2, 0.6^3. The plain value before
*     each is the same number for a browser that does not know the function.
*     The fourth step is extrapolation -- the screenshots have no fourth
*     level -- and says so rather than looking measured.
      `.kids{margin-left:18px;padding:0;background:#eaf4ff;`  &&
      `background:color-mix(in srgb,#eaf4ff 100%,#fff);`  &&
      `border-top:1px solid #b9c6d6;border-bottom:1px solid #b9c6d6}`  &&
      `.kids .kids{background:#f2f8ff;background:color-mix(in srgb,#eaf4ff 60%,#fff)}`  &&
      `.kids .kids .kids{background:#f7fbff;background:color-mix(in srgb,#eaf4ff 36%,#fff)}`  &&
      `.kids .kids .kids .kids{background:#fafdff;background:color-mix(in srgb,#eaf4ff 22%,#fff)}`  &&
      `.leaf{display:flex;align-items:center;gap:6px;padding:2px 4px 2px 14px;text-decoration:none;color:#1c2f43;border-radius:2px}` &&
      `a.leaf:hover{background:#dbe7f4}` &&
      `a.leaf:hover .lbl{text-decoration:underline}` &&
      `.leaf.dead{color:#5d7186}` &&
      `.lbl{white-space:nowrap}` &&
      `.tech{color:#7c8ea3;font-size:11px;font-family:"DejaVu Sans Mono","Consolas",monospace;white-space:nowrap}` &&
      `.det{color:#9aa9ba;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` &&
      `.ico{width:13px;height:11px;flex:none;border-radius:1px;position:relative}` &&
      `.ico-folder{background:#f0c14b;border:1px solid #b98f1e}` &&
      `.ico-folder::before{content:"";position:absolute;left:0;top:-3px;width:6px;height:3px;background:#f0c14b;` &&
      `border:1px solid #b98f1e;border-bottom:none;border-radius:1px 1px 0 0}` &&
      `.ico-odata{background:#2f6fb5;border:1px solid #1d4f8a}` &&
      `.ico-icf{background:#2e8b57;border:1px solid #1e6b3f}` &&
      `.ico-apc{background:#8e6fbf;border:1px solid #6a4fa0}` &&
      `.ico-app{background:#e07b39;border:1px solid #b45c22}` &&
      `.ico-pack{background:#7c8ea3;border:1px solid #5d7186}` &&
      `.ico-tcode{background:#c94f4f;border:1px solid #9c3535}` &&
* the pane when a transaction is running in it: the same box the tree lives
* in, so the splitter, the image panel and the bars do not move when you
* enter one, with a head that names what is running and a way back out
      `.tree.run{padding:0;background:#fff;display:flex;flex-direction:column}` &&
      `.runhead{display:flex;align-items:center;gap:6px;padding:4px 8px;background:#dbe7f4;` &&
      `border-bottom:1px solid #b9c6d6;font-size:12px;color:#1c2f43}` &&
      `.runexit{margin-left:auto;text-decoration:none;color:#1f4e79;padding:0 4px}` &&
      `.runexit:hover{background:#c3d7ea}` &&
      `.tree.run .gg-controls{flex:1;min-height:0}` &&
      `.tree.run .gg-controls iframe{width:100%;height:100%;min-height:320px;border:0;background:#fff}` &&
      `.art{flex:1 1 auto;min-width:140px;position:relative;overflow:hidden;background:#0b2544}` &&
      `.artbg{position:absolute;inset:0;width:100%;height:100%}` &&
      `.artscene{position:absolute;inset:0;width:100%;height:100%;opacity:.92}` &&
      `.artmark{position:absolute;right:20px;top:0;bottom:0;width:190px;color:#fff;` &&
      `display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right;gap:10px}` &&
      `.artname{font-size:19px;letter-spacing:.5px;opacity:.95}` &&
      `.artname b{font-weight:bold}` &&
      `.artsid{font-size:36px;font-weight:bold;letter-spacing:3px;opacity:.9}` &&
      `.artnote{font-size:11px;opacity:.6}` &&
      `.bar{background:#eef2f7;border-top:1px solid #b9c6d6;padding:4px 10px;display:flex;justify-content:space-between;` &&
      `align-items:center;color:#2b3b4d;font-size:12px}` &&
      `.msg{color:#a3480d;font-weight:bold}` &&
      `.about{flex:1;overflow:auto;padding:18px 24px;background:#f7fafd}` &&
      `.about h1{font-size:20px;margin:0 0 6px}` &&
      `.about p{max-width:70ch;line-height:1.5}` &&
      `.kv{border-collapse:collapse;margin:12px 0}` &&
      `.kv th{text-align:left;font-weight:normal;color:#5d7186;padding:3px 18px 3px 0;vertical-align:top;white-space:nowrap}` &&
      `.kv td{padding:3px 0;font-family:"DejaVu Sans Mono","Consolas",monospace}` &&
      `.back{color:#2668a3}` &&
      `@media (max-width:760px){.tree{width:62%;min-width:160px}.artmark{display:none}.det{display:none}}`.
  ENDMETHOD.

  METHOD page.
    DATA lt_nodes TYPE tt_node.
    DATA ls_sys   TYPE zosd_sys.
    DATA ls_ident TYPE ty_ident.
    DATA lv_msg   TYPE string.
    DATA lv_pane  TYPE string.

    lt_nodes = menu( ).

* the left pane: what a transaction drew, or the menu when nothing is running
    IF iv_body IS INITIAL.
      lv_pane = `<div class="tree" title="drag the grip in the corner to move the splitter">` &&
                branch( it_nodes = lt_nodes iv_parent = '' ) && `</div>`.
    ELSE.
      lv_pane = |<div class="tree run" data-transaction="{ esc( iv_heading ) }">| &&
                |<div class="runhead"><span class="ico ico-tcode"></span>{ esc( iv_heading ) }| &&
                |<a class="runexit" href="{ gc_path }/" target="_top" title="Back to the menu">&#9650;</a></div>| &&
                iv_body && `</div>`.
    ENDIF.

    SELECT SINGLE * FROM zosd_sys INTO ls_sys.
* who this system is: sy, and the process the status tables were written in.
* It used to be an invented session number and an invented client.
    ls_ident = identity( ).

    lv_msg = iv_message.
    IF lv_msg IS INITIAL.
      lv_msg = |{ lines( lt_nodes ) } nodes, from the system status tables|.
    ENDIF.

    rv_html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width,initial-scale=1">` &&
      `<link rel="icon" type="image/svg+xml" href="/app/osg.svg"><title>Easy Success - open-steamgate</title><style>` && style( ) && `</style></head><body>` &&
      `<div class="win">` &&
      |<div class="title"><span>Easy Success</span><small>{ esc( ls_ident-info ) }</small></div>| &&
      |<div class="menu">{ menubar( lt_nodes ) }</div>| &&
      `<div class="tools">` &&
      |<form class="cmdbox" method="get" action="{ gc_path }/" target="_top">| &&
      |<input class="cmd" type="text" name="okcode" value="{ esc( iv_okcode ) }" autocomplete="off" spellcheck="false" aria-label="Command field">| &&
      `<button class="btn go" type="submit" title="Enter">&#10003;</button></form>` &&
      `<span class="sep"></span>` &&
* the standard toolbar of every SAP screen. Nothing behind them: this screen
* has one function, and a button that did nothing but look right would be
* worse than one that says it is not wired to anything.
      `<button class="btn ghost" type="button" disabled title="Back">&#9664;</button>` &&
      `<button class="btn ghost" type="button" disabled title="Exit">&#9650;</button>` &&
      `<button class="btn ghost" type="button" disabled title="Cancel">&#10005;</button>` &&
      `<span class="sep"></span>` &&
      `<span class="dim">type a name and press Enter, or pick one from the menu</span>` &&
      `</div>` &&
      `<span id="nopic"></span>` &&
* the four widths the ridge steps through; the first is the default
      `<input class="wsel" type="radio" name="w" id="w1" checked>` &&
      `<input class="wsel" type="radio" name="w" id="w2">` &&
      `<input class="wsel" type="radio" name="w" id="w3">` &&
      `<input class="wsel" type="radio" name="w" id="w4">` &&
      `<div class="body">` &&
      lv_pane &&
      `<div class="split" title="click the boundary to step it, drag the grip at its foot for any width; the arrow hides the picture">` &&
      `<label class="wstep to2" for="w2"></label><label class="wstep to3" for="w3"></label>` &&
      `<label class="wstep to4" for="w4"></label><label class="wstep to1" for="w1"></label>` &&
      `<a class="splitbtn splithide" href="#nopic" title="hide the picture">&#171;</a>` &&
      `<a class="splitbtn splitshow" href="#showpic" title="show the picture">&#187;</a>` &&
      `</div>` &&
      artwork( ls_ident-sid ) &&
      `</div>` &&
      |<div class="bar"><span class="msg" id="msg">{ esc( lv_msg ) }</span>| &&
      |<span class="dim" id="sysinfo">{ esc( ls_ident-info ) } &middot; { esc( ls_ident-host_kind ) }| &&
      | &middot; { esc( CONV string( ls_sys-root_hint ) ) }</span></div>| &&
      `</div>` && drag_script( ) && `</body></html>`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_okcode TYPE string.
    DATA ls_node   TYPE ty_node.
    DATA lv_msg    TYPE string.
    DATA lv_path   TYPE string.
    DATA ls_step   TYPE zcl_osd_tran=>ty_step.

* Help > About is a page of this class one path below the screen, the way a
* service of a system has more than one node under it, and so is the dialog
* step of a running transaction (tx/). The shim takes the mount off the
* front, so what is left here is the sub-path and nothing else.
    lv_path = server->request->get_header_field( '~path_info' ).
    REPLACE ALL OCCURRENCES OF '/' IN lv_path WITH ''.
    CONDENSE lv_path.
    TRANSLATE lv_path TO UPPER CASE.
    IF lv_path = 'ABOUT'.
      server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
      server->response->set_cdata( about( ) ).
      RETURN.
    ENDIF.

* A dialog step: the click in the document the transaction drew, coming back
* as the sapevent it is. The whole screen is answered, not a fragment, so
* the title bar, the menu, the command field and the status bar stay around
* the transaction the way they do on a system.
    IF lv_path = 'TX'.
      ls_step = zcl_osd_tran=>resume(
        iv_query = server->request->get_header_field( '~query_string' )
        iv_body  = server->request->get_cdata( ) ).
      server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
      server->response->set_cdata( page( iv_message = ls_step-message
                                         iv_okcode  = ls_step-tcode
                                         iv_body    = ls_step-body
                                         iv_heading = |{ ls_step-tcode } - { ls_step-title }| ) ).
      RETURN.
    ENDIF.

* The shim hands the query string on as it arrived, so the field is decoded
* here: a browser submitting a GET form sends a space as "+" and everything
* else percent-encoded, and "System status" has a space in it.
    lv_okcode = server->request->get_form_field( 'okcode' ).
    REPLACE ALL OCCURRENCES OF '+' IN lv_okcode WITH ` `.
    lv_okcode = cl_http_utility=>unescape_url( lv_okcode ).

    IF lv_okcode IS NOT INITIAL.
      ls_node = resolve( lv_okcode ).
      IF ls_node-kind IS INITIAL.
        lv_msg = |Transaction { to_upper( lv_okcode ) } does not exist|.
      ELSEIF ls_node-kind = gc_kind-transaction.
* A transaction node is the kind that is run rather than linked to, and this
* is the running (backlog G.3). START makes a session, enters the class the
* *.tran.xml names and gives back what it drew; one that cannot be entered
* here comes back with the reason instead of a screen.
        ls_step = zcl_osd_tran=>start( ls_node-name ).
        IF ls_step-ok = abap_true.
          server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
          server->response->set_cdata( page( iv_message = ls_step-message
                                             iv_okcode  = ls_step-tcode
                                             iv_body    = ls_step-body
                                             iv_heading = |{ ls_step-tcode } - { ls_step-title }| ) ).
          RETURN.
        ENDIF.
        IF ls_step-known = abap_false.
* the screen has the node and no *.tran.xml backs it, which is true of
* exactly one: abapGit. Its own detail says what is missing, and repeating
* "does not exist" about something visibly in the menu would be a lie the
* tree could catch nobody at
          lv_msg = |{ ls_node-name } cannot be started here: { ls_node-detail }|.
        ELSE.
          lv_msg = ls_step-message.
        ENDIF.
      ELSEIF ls_node-url IS INITIAL.
        lv_msg = |{ ls_node-name } is { ls_node-detail }, and has no page of its own|.
      ELSE.
        server->response->set_status( code = 302 reason = 'Found' ).
        server->response->set_header_field( name = 'location' value = ls_node-url ).
        RETURN.
      ENDIF.
    ENDIF.

    server->response->set_header_field( name = 'content-type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( iv_message = lv_msg iv_okcode = lv_okcode ) ).
  ENDMETHOD.

ENDCLASS.
