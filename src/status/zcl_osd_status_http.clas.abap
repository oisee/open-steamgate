CLASS zcl_osd_status_http DEFINITION PUBLIC CREATE PUBLIC.
* The system status, written from outside, as an ICF node.
*
* This was an express route in one host: `app.post("/osd/status")`, a body
* read and a call to `zcl_osd_status=>refresh`. It is the first of the
* rivals `tools/osd-routes.mjs` counts to become a node, and it was found by
* an adversarial review rather than by the scoreboard -- the classifier had
* filed it as "needs process state" because its error branch calls
* `res.status(500)`, which is express's vocabulary and not evidence about
* the handler.
*
* Nothing of it needed the host. The work was already ABAP; what surrounded
* it was a body read, a JSON answer and an error log, and a node gets all
* three from the shim. The one thing lost is the host's `dump()` on the
* error path, and that is given back to **every** node at once by passing
* `onError` to `mountServices`, which is a better place for it than here.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_osd_status_http IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA lv_body TYPE string.
    DATA lv_rows TYPE i.

    IF server->request->get_method( ) <> 'POST'.
*     named, because "405" alone makes a wrong verb and a wrong path look
*     the same to whoever is reading a log at three in the morning
      server->response->set_status( code = 405 reason = 'Method Not Allowed' ).
      server->response->set_content_type( 'text/plain; charset=utf-8' ).
      server->response->set_cdata( 'the status is written with POST and a JSON body' ).
      RETURN.
    ENDIF.

    lv_body = server->request->get_cdata( ).
    lv_rows = zcl_osd_status=>refresh( iv_json = lv_body ).

    server->response->set_status( code = 200 reason = 'OK' ).
    server->response->set_content_type( 'application/json; charset=utf-8' ).
    server->response->set_cdata( |\{ "rows": { lv_rows } \}| ).
  ENDMETHOD.

ENDCLASS.
