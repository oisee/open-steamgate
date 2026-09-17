CLASS zcl_osd_webgui DEFINITION PUBLIC FINAL CREATE PUBLIC.

* SAP Easy Access, served by ABAP.
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
* TRANSACTION has exactly one entry today (ZABAPGIT) and that entry answers
* "not yet". It is here so that the third kind exists before anything needs
* it: making a transaction real is filling in RUN, not reshaping the screen.
* What a real one has to do is written down in docs/webgui.md.
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

* the menu of this system, as rows; the tree and the command field read this
    CLASS-METHODS menu
      RETURNING VALUE(rt_nodes) TYPE tt_node.

* what an ok-code names, or an initial node when the system has no such thing
    CLASS-METHODS resolve
      IMPORTING iv_code        TYPE string
      RETURNING VALUE(rs_node) TYPE ty_node.

* the screen
    CLASS-METHODS page
      IMPORTING iv_message     TYPE string OPTIONAL
                iv_okcode      TYPE string OPTIONAL
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
                   iv_detail = 'not yet: see docs/webgui.md'
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
                         iv_detail = CONV string( ls_svc-handler ) iv_badge = 'ODATA'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'ICF'.
          lv_name = last_segment( CONV string( ls_svc-path ) ).
          add( EXPORTING iv_parent = 'ICF' iv_id = |ICF-{ lv_name }| iv_kind = gc_kind-service
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name iv_url = CONV string( ls_svc-path )
                         iv_detail = CONV string( ls_svc-handler ) iv_badge = 'ICF'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'APC'.
* a websocket has no page of its own; the node names the class that answers
          lv_name = last_segment( CONV string( ls_svc-path ) ).
          add( EXPORTING iv_parent = 'APC' iv_id = |APC-{ lv_name }| iv_kind = gc_kind-service
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name
                         iv_detail = CONV string( ls_svc-handler ) iv_badge = 'APC'
               CHANGING  ct_nodes = rt_nodes ).
        WHEN 'APP'.
          lv_name = ls_svc-handler.
          TRANSLATE lv_name TO UPPER CASE.
          add( EXPORTING iv_parent = 'APPS' iv_id = |APP-{ lv_name }| iv_kind = gc_kind-app
                         iv_text = COND string( WHEN ls_svc-text IS INITIAL THEN lv_name ELSE ls_svc-text )
                         iv_name = lv_name iv_url = CONV string( ls_svc-path )
                         iv_detail = CONV string( ls_svc-handler ) iv_badge = 'APP'
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

* The one transaction, and the reason the kind exists. It is listed twice on
* purpose, the way a favourite is a second entry for the same object.
    add( EXPORTING iv_parent = 'TOOLS' iv_id = 'TOOLS-ZABAPGIT' iv_kind = gc_kind-transaction
                   iv_text = 'abapGit' iv_name = 'ZABAPGIT'
                   iv_detail = 'not yet: see docs/webgui.md'
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
* The tall panel down the right-hand side, and the bulge in it.
*
* On a real SAP Easy Access screen this is a picture control showing whatever
* SMW0 object the system was configured with, and its left edge curves into
* the menu. It is drawn here rather than loaded, so the screen needs no
* object and no second request: one path, curved out to the left in the
* middle, filled with the gradient, and the wordmark laid over it in HTML so
* that stretching the panel does not stretch the letters.
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
      `<div class="artmark">` &&
      `<div class="artgate"><span></span><span></span><span></span></div>` &&
      `<div class="artname">open<b>steamgate</b></div>` &&
      |<div class="artsid">{ esc( iv_sid ) }</div>| &&
      `<div class="artnote">a gateway that is not there</div>` &&
      `</div></div>`.
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
      `.menu{background:#eef2f7;border-bottom:1px solid #c5d0dd;padding:3px 10px;color:#2b3b4d}` &&
      `.menu b{margin-right:18px;font-weight:normal}` &&
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
      `.tree{flex:1;overflow:auto;padding:10px 6px 24px 14px;background:#f7fafd}` &&
      `.fld{margin:0}` &&
      `.fld>summary{list-style:none;cursor:pointer;padding:2px 4px;display:flex;align-items:center;gap:6px;border-radius:2px}` &&
      `.fld>summary::-webkit-details-marker{display:none}` &&
      `.fld>summary::before{content:"\25B6";color:#5d7186;font-size:9px;width:10px;display:inline-block}` &&
      `.fld[open]>summary::before{content:"\25BC"}` &&
      `.fld>summary:hover{background:#dbe7f4}` &&
      `.kids{margin-left:16px;border-left:1px dotted #b9c6d6;padding-left:6px}` &&
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
      `.art{width:300px;flex:none;position:relative;overflow:hidden;background:#0b2544}` &&
      `.artbg{position:absolute;inset:0;width:100%;height:100%}` &&
      `.artmark{position:absolute;right:20px;top:0;bottom:0;width:190px;color:#fff;` &&
      `display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right;gap:6px}` &&
      `.artgate{display:flex;gap:4px;align-items:flex-end;height:44px;opacity:.9}` &&
      `.artgate span{width:10px;background:#ffffff;border-radius:2px 2px 0 0;opacity:.85}` &&
      `.artgate span:nth-child(1){height:22px}.artgate span:nth-child(2){height:44px}.artgate span:nth-child(3){height:30px}` &&
      `.artname{font-size:19px;letter-spacing:.5px;opacity:.95}` &&
      `.artname b{font-weight:bold}` &&
      `.artsid{font-size:36px;font-weight:bold;letter-spacing:3px;opacity:.9}` &&
      `.artnote{font-size:11px;opacity:.6}` &&
      `.bar{background:#eef2f7;border-top:1px solid #b9c6d6;padding:4px 10px;display:flex;justify-content:space-between;` &&
      `align-items:center;color:#2b3b4d;font-size:12px}` &&
      `.msg{color:#a3480d;font-weight:bold}` &&
      `@media (max-width:760px){.art{width:120px}.artmark{display:none}.det{display:none}}`.
  ENDMETHOD.

  METHOD page.
    DATA lt_nodes TYPE tt_node.
    DATA ls_sys   TYPE zosd_sys.
    DATA lv_sid   TYPE string.
    DATA lv_info  TYPE string.
    DATA lv_msg   TYPE string.

    lt_nodes = menu( ).

    SELECT SINGLE * FROM zosd_sys INTO ls_sys.
    lv_sid = COND string( WHEN ls_sys-sid IS INITIAL THEN 'OSG' ELSE ls_sys-sid ).
    lv_info = |{ lv_sid } (1) 100 { COND string( WHEN ls_sys-host_kind IS INITIAL THEN 'node' ELSE ls_sys-host_kind ) }|.

    lv_msg = iv_message.
    IF lv_msg IS INITIAL.
      lv_msg = |{ lines( lt_nodes ) } nodes, from the system status tables|.
    ENDIF.

    rv_html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` &&
      `<meta name="viewport" content="width=device-width,initial-scale=1">` &&
      `<title>SAP Easy Access - open-steamgate</title><style>` && style( ) && `</style></head><body>` &&
      `<div class="win">` &&
      |<div class="title"><span>SAP Easy Access</span><small>{ esc( lv_info ) }</small></div>| &&
      `<div class="menu"><b>Menu</b><b>Edit</b><b>Favorites</b><b>Extras</b><b>System</b><b>Help</b></div>` &&
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
      `<div class="body">` &&
      `<div class="tree">` && branch( it_nodes = lt_nodes iv_parent = '' ) && `</div>` &&
      artwork( lv_sid ) &&
      `</div>` &&
      |<div class="bar"><span class="msg" id="msg">{ esc( lv_msg ) }</span>| &&
      |<span class="dim">{ esc( lv_info ) } &middot; { esc( CONV string( ls_sys-root_hint ) ) }</span></div>| &&
      `</div></body></html>`.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_okcode TYPE string.
    DATA ls_node   TYPE ty_node.
    DATA lv_msg    TYPE string.

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
* The seam. A transaction node is the kind of node that is run rather than
* linked to, and running one is the next step rather than this one: what it
* has to do is in docs/webgui.md.
        lv_msg = |{ ls_node-name } is not runnable yet: the GUI substitutes are wired in, the round trip is not proven|.
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
