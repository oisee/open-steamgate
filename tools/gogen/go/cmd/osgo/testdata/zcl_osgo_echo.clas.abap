* A handler for the OSGo host's own check (tools/gogen/osgo.mjs --echo):
* it answers what the ICF objects the shim built say about the request,
* so the kernel lines of the shim can be tested without all of OSG.
CLASS zcl_osgo_echo DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
ENDCLASS.

CLASS zcl_osgo_echo IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    DATA lt_fields TYPE tihttpnvp.
    DATA ls_field TYPE ihttpnvp.
    DATA lv_out TYPE string.
    server->request->get_form_fields_cs( CHANGING fields = lt_fields ).
    lv_out = |{ server->request->get_header_field( '~request_method' ) } { server->request->get_header_field( '~path' ) } { server->request->get_header_field( '~path_info' ) } q={ server->request->get_header_field( '~query_string' ) } host={ server->request->get_header_field( 'host' ) }|.
    LOOP AT lt_fields INTO ls_field.
      lv_out = lv_out && | { ls_field-name }={ ls_field-value }|.
    ENDLOOP.
    lv_out = lv_out && | body={ server->request->get_cdata( ) }|.
    server->response->set_header_field( name = 'x-echo' value = 'yes' ).
    server->response->set_content_type( 'text/plain' ).
    server->response->set_cdata( lv_out ).
    server->response->set_status( code = 201 reason = 'Made' ).
  ENDMETHOD.
ENDCLASS.
