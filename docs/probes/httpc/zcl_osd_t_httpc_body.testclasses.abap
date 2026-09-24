* Request body, first pass. The text is a, e-acute, euro sign, z (UTF-8
* 61 C3A9 E282AC 7A), posted to /sap/bc/abap/demo_post?input=X, which splits
* the body it decoded at & and answers the parts inside
* <span class="nprpnwrp">. The demo handler's own unescape_url turns every
* non-ASCII character into #, so this pass shows the client side
* (reqdata = request->get_data( ) before and after SEND) and only a count of
* characters on the server side; the SOAP pass (zcl_osd_t_httpc_body2) shows
* the decoded text.
CLASS ltcl DEFINITION FINAL FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS m0_transport FOR TESTING.
    METHODS b1_utf8 FOR TESTING.
    METHODS b2_plain FOR TESTING.
    METHODS b3_no_ctype FOR TESTING.
    METHODS b4_latin1_before FOR TESTING.
    METHODS b5_latin1_after FOR TESTING.
    METHODS b6_set_data_not_utf8 FOR TESTING.
    METHODS b7_get_cdata_not_utf8 FOR TESTING.
    METHODS b8_emoji FOR TESTING.
    METHODS go IMPORTING iv_ctype TYPE string OPTIONAL iv_after TYPE abap_bool DEFAULT abap_false
                         iv_body TYPE string OPTIONAL iv_xbody TYPE xstring OPTIONAL.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD go.
    DATA lv_body TYPE string.
    lv_body = iv_body.
    IF lv_body IS INITIAL AND iv_xbody IS INITIAL.
      lv_body = zcl_osd_t_httpc=>utf8( '61C3A9E282AC7A' ).
    ENDIF.
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg =
      zcl_osd_t_httpc=>call( iv_url = zcl_osd_t_httpc=>base && `/sap/bc/abap/demo_post?input=X`
        iv_method = `POST` iv_ctype = iv_ctype iv_ctype_after = iv_after iv_body = lv_body iv_xbody = iv_xbody
        iv_find = `"nprpnwrp">` iv_len = 30 ) ).
  ENDMETHOD.
  METHOD m0_transport.
    DATA lv_body TYPE string.
    lv_body = zcl_osd_t_httpc=>utf8( '61C3A9E282AC7A' ).
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg = |strlen:{ strlen( lv_body ) } text:{ lv_body }| ).
  ENDMETHOD.
  METHOD b1_utf8.
    go( iv_ctype = `text/plain; charset=utf-8` ).
  ENDMETHOD.
  METHOD b2_plain.
    go( iv_ctype = `text/plain` ).
  ENDMETHOD.
  METHOD b3_no_ctype.
    go( ).
  ENDMETHOD.
  METHOD b4_latin1_before.
    go( iv_ctype = `text/plain; charset=iso-8859-1` ).
  ENDMETHOD.
  METHOD b5_latin1_after.
    go( iv_ctype = `text/plain; charset=iso-8859-1` iv_after = abap_true ).
  ENDMETHOD.
  METHOD b6_set_data_not_utf8.
    go( iv_ctype = `text/plain; charset=utf-8` iv_xbody = '61E97A' ).
  ENDMETHOD.
  METHOD b7_get_cdata_not_utf8.
    DATA li_client TYPE REF TO if_http_client.
    DATA lv_out TYPE string.
    DATA lx TYPE REF TO cx_root.
    cl_http_client=>create_by_url( EXPORTING url = zcl_osd_t_httpc=>base IMPORTING client = li_client ).
    li_client->request->set_data( '61E97A' ).
    TRY.
        lv_out = li_client->request->get_cdata( ).
        lv_out = |nocharset:{ strlen( lv_out ) }:{ cl_abap_codepage=>convert_to( lv_out ) }|.
      CATCH cx_root INTO lx.
        lv_out = |nocharset CAUGHT:{ cl_abap_classdescr=>get_class_name( lx ) }:{ lx->get_text( ) }|.
    ENDTRY.
    li_client->request->set_content_type( `text/plain; charset=utf-8` ).
    TRY.
        lv_out = |{ lv_out } utf8:{ cl_abap_codepage=>convert_to( li_client->request->get_cdata( ) ) }|.
      CATCH cx_root INTO lx.
        lv_out = |{ lv_out } utf8 CAUGHT:{ cl_abap_classdescr=>get_class_name( lx ) }:{ lx->get_text( ) }|.
    ENDTRY.
    li_client->request->set_content_type( `text/plain; charset=iso-8859-1` ).
    TRY.
        lv_out = |{ lv_out } latin1:{ cl_abap_codepage=>convert_to( li_client->request->get_cdata( ) ) }|.
      CATCH cx_root INTO lx.
        lv_out = |{ lv_out } latin1 CAUGHT:{ cl_abap_classdescr=>get_class_name( lx ) }:{ lx->get_text( ) }|.
    ENDTRY.
    li_client->close( ).
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg = lv_out ).
  ENDMETHOD.
  METHOD b8_emoji.
    go( iv_ctype = `text/plain; charset=utf-8` iv_body = zcl_osd_t_httpc=>utf8( '61F09F98807A' ) ).
  ENDMETHOD.
ENDCLASS.
