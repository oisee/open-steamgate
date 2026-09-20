CLASS zcl_osd_bsp DEFINITION PUBLIC CREATE PUBLIC.
* The pages of a BSP application, served by this system.
*
* Until this class existed, `webapp/` and every pack were static files behind
* `express` -- the only place in this tree where the request path was not
* ABAP, and the reason the same artefact did not run in both runtimes. A BSP
* application is an object here (a `*.wapa.xml` and its pages, the shape
* abapGit writes and `docs/a4h-deploy.md` measured on a system); this serves
* it on the path a real system answers on.
*
* **It is a handler like any other, and that is the point.** The node that
* names it is an ordinary `*.sicf.xml`, so the routing travels with the code
* the way everything else does, and "who answers this path" stops being a
* second registry in a JavaScript host.
*
* What it deliberately does not do: no BSP runtime, no page compilation, no
* stateful application. These pages are `PAGETYPE X` -- content -- which is
* what a UI5 application's pages are. A real system serves them through
* `/UI5/CL_UI5_HTTP_HANDLER`, which the application's own node inherits from
* its branch rather than naming; we name the handler on the node because our
* tree has no inheritance to lean on yet.
  PUBLIC SECTION.
    INTERFACES if_http_extension.

*   `/sap/bc/ui5_ui5/sap/<app>/<page>` -> the application and the page.
*   Exposed for the test, because a path parser checked only through HTTP is
*   checked in one shape out of the several a client will send.
    CLASS-METHODS split
      IMPORTING
        iv_path TYPE string
      EXPORTING
        ev_app  TYPE string
        ev_page TYPE string.
  PROTECTED SECTION.
  PRIVATE SECTION.
*   The branch, without the namespace: an application may live under any of
*   them. `tools/osd-bsp-app.mjs` already writes nodes under `mindset` as
*   well as `sap`, and the corpus carries a real one at
*   /sap/bc/ui5_ui5/mindset/analyzer_detail/ -- so a parser that assumed
*   `sap` answered "no page bc/ui5_ui5/mindset/... in application SAP" for
*   every other namespace. Found by an adversarial review, 2026-09-20.
    CONSTANTS gc_branch TYPE string VALUE '/sap/bc/ui5_ui5/' ##NO_TEXT.
ENDCLASS.

CLASS zcl_osd_bsp IMPLEMENTATION.

  METHOD split.
    DATA lv_rest TYPE string.
    DATA lv_at   TYPE i.

    CLEAR ev_app.
    CLEAR ev_page.
    lv_rest = iv_path.
*   Everything after the node's own path. The offset is the constant's own
*   length and not a number beside it: a literal 20 here duplicates
*   strlen( gc_base ), and a duplicated rule is one that goes wrong silently
*   the day somebody edits the other half -- every path test would still
*   pass, because they check paths and not the link between the two.
    IF lv_rest CS gc_branch.
      lv_at   = sy-fdpos + strlen( gc_branch ).
      lv_rest = lv_rest+lv_at.
*     and then the namespace segment, whatever it is called
      FIND FIRST OCCURRENCE OF '/' IN lv_rest MATCH OFFSET lv_at.
      IF sy-subrc = 0.
        lv_at   = lv_at + 1.
        lv_rest = lv_rest+lv_at.
      ENDIF.
    ENDIF.
*   a query string is not part of the page name
    IF lv_rest CS '?'.
      lv_rest = lv_rest(sy-fdpos).
    ENDIF.
    WHILE strlen( lv_rest ) > 0 AND lv_rest(1) = '/'.
      lv_rest = lv_rest+1.
    ENDWHILE.
    IF lv_rest IS INITIAL.
      RETURN.
    ENDIF.
    FIND FIRST OCCURRENCE OF '/' IN lv_rest MATCH OFFSET lv_at.
    IF sy-subrc <> 0.
*     the application alone: its start page, the way a directory URL behaves
      ev_app  = lv_rest.
      ev_page = 'index.html'.
    ELSE.
      ev_app  = lv_rest(lv_at).
      lv_at   = lv_at + 1.
      ev_page = lv_rest+lv_at.
      IF ev_page IS INITIAL.
        ev_page = 'index.html'.
      ENDIF.
    ENDIF.
    TRANSLATE ev_app TO UPPER CASE.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_path  TYPE string.
    DATA lv_app   TYPE string.
    DATA lv_page  TYPE string.
    DATA lt_pages TYPE zcl_stg_bsp_registry=>tt_page.
    DATA ls_page  LIKE LINE OF lt_pages.
    DATA lv_found TYPE abap_bool.
    DATA lv_x     TYPE xstring.

    lv_path = server->request->get_header_field( '~path_info' ).
    IF lv_path IS INITIAL.
      lv_path = server->request->get_header_field( '~path' ).
    ENDIF.
    split( EXPORTING iv_path = lv_path
           IMPORTING ev_app  = lv_app
                     ev_page = lv_page ).

    lt_pages = zcl_stg_bsp_registry=>pages( ).
    LOOP AT lt_pages INTO ls_page.
      IF ls_page-app = lv_app AND ls_page-name = lv_page.
        lv_found = abap_true.
        EXIT.
      ENDIF.
    ENDLOOP.

    IF lv_found = abap_false.
*     Named, so the next person does not guess. A 404 that says only "not
*     found" makes a missing page and a wrong application look the same.
      server->response->set_status( code = 404 reason = 'Not Found' ).
      server->response->set_content_type( 'text/plain; charset=utf-8' ).
      server->response->set_cdata( |no page { lv_page } in BSP application { lv_app }| ).
      RETURN.
    ENDIF.

    lv_x = zcl_abapgit_convert=>base64_to_xstring( ls_page-b64 ).
    server->response->set_status( code = 200 reason = 'OK' ).
    server->response->set_content_type( ls_page-mime ).
    server->response->set_data( lv_x ).
  ENDMETHOD.

ENDCLASS.
