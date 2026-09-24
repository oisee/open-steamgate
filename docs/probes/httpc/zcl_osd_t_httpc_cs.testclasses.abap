* set_cdata of a, e-acute, euro sign, z under several ways of naming a
* charset (set_content_type, set_header_field in two spellings); get_data
* shows the bytes the request entity holds, which the SOAP pass showed to be
* the bytes that are sent.
CLASS ltcl DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS spellings FOR TESTING.
    METHODS one IMPORTING iv_how TYPE i iv_ctype TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD one.
    DATA li_client TYPE REF TO if_http_client.
    cl_http_client=>create_by_url( EXPORTING url = zcl_osd_t_httpc=>base IMPORTING client = li_client ).
    CASE iv_how.
      WHEN 1.
        li_client->request->set_content_type( iv_ctype ).
      WHEN 2.
        li_client->request->set_header_field( name = `content-type` value = iv_ctype ).
      WHEN 3.
        li_client->request->set_header_field( name = `Content-Type` value = iv_ctype ).
    ENDCASE.
    li_client->request->set_cdata( zcl_osd_t_httpc=>utf8( '61C3A9E282AC7A' ) ).
    rv = |[{ iv_how }:{ iv_ctype }]={ li_client->request->get_data( ) } |.
    li_client->close( ).
  ENDMETHOD.
  METHOD spellings.
    DATA lv TYPE string.
    lv = one( iv_how = 1 iv_ctype = `text/plain; charset=iso-8859-1` )
      && one( iv_how = 1 iv_ctype = `text/plain;charset=ISO-8859-1` )
      && one( iv_how = 1 iv_ctype = `text/plain; charset=windows-1252` )
      && one( iv_how = 1 iv_ctype = `text/plain; charset=utf-16` )
      && one( iv_how = 2 iv_ctype = `text/plain; charset=iso-8859-1` )
      && one( iv_how = 3 iv_ctype = `text/plain; charset=iso-8859-1` ).
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg = lv ).
  ENDMETHOD.
ENDCLASS.
