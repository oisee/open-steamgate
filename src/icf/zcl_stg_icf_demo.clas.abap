* An ICF service that is not the OData front, which is the point of it.
*
* OSD serves /sap/opu/odata/sap through cl_express_icf_shim, and the shim
* takes the handler class by name, so a second handler on a second path was
* never a question of machinery. What was missing was SICF: the table that
* says which class answers which URL. This class exists so that table has
* something of our own to answer with, and so the mount is proven by a test
* rather than by a repository we do not control.
CLASS zcl_stg_icf_demo DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    CLASS-METHODS marker RETURNING VALUE(rv_marker) TYPE string.
ENDCLASS.

CLASS zcl_stg_icf_demo IMPLEMENTATION.
  METHOD marker.
    rv_marker = 'W2-OLD'.
  ENDMETHOD.

  METHOD if_http_extension~handle_request.
    DATA lv_path TYPE string.
    DATA lv_body TYPE string.
    DATA lv_marker TYPE string.

    lv_path = server->request->get_header_field( '~path_info' ).

    lv_marker = marker( ).

    lv_body = |\{"service":"ZSTG_ICF_DEMO","path":"{ lv_path }","method":"{ server->request->get_method( ) }","marker":"{ lv_marker }"\}|.

    server->response->set_header_field( name  = 'content-type'
                                        value = 'application/json' ).
    server->response->set_cdata( lv_body ).
  ENDMETHOD.

ENDCLASS.
