* Request body, SOAP pass. The SOAP-RFC handler parses the posted envelope
* and calls ZOSG_HTTPC_SLEEP, which answers the IV_TEXT it received as UTF-8
* in EV_HEX (base64 in the answer). Text: a, e-acute, euro sign, z
* (UTF-8 61 C3A9 E282AC 7A). c1 and c3 post known UTF-8 bytes with set_data
* and calibrate the receiving side: it decodes UTF-8 whatever the charset
* in the header says, so an s-case that answers the same text was sent as
* UTF-8. (A c2 case, the envelope converted to ISO-8859-1 for set_data,
* dumped CONVT_CODEPAGE in the probe itself, because the euro sign has no
* ISO-8859-1 code, and is left out.)
CLASS ltcl DEFINITION FINAL FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS s1_cdata_utf8 FOR TESTING.
    METHODS s2_cdata_latin1 FOR TESTING.
    METHODS s3_cdata_no_charset FOR TESTING.
    METHODS s4_cdata_latin1_after FOR TESTING.
    METHODS c1_data_utf8_bytes_latin1_hdr FOR TESTING.
    METHODS c3_data_utf8_bytes_utf8_hdr FOR TESTING.
    METHODS go IMPORTING iv_ctype TYPE string iv_after TYPE abap_bool DEFAULT abap_false
                         iv_body TYPE string OPTIONAL iv_xbody TYPE xstring OPTIONAL.
    METHODS text RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD text.
    rv = zcl_osg_httpc_probe=>soap_sleep( iv_seconds = 0 iv_text = zcl_osg_httpc_probe=>utf8( '61C3A9E282AC7A' ) ).
  ENDMETHOD.
  METHOD go.
    cl_abap_unit_assert=>fail( level = if_aunit_constants=>tolerable msg =
      zcl_osg_httpc_probe=>call( iv_url = zcl_osg_httpc_probe=>base && `/sap/bc/soap/rfc`
        iv_method = `POST` iv_ctype = iv_ctype iv_ctype_after = iv_after iv_body = iv_body iv_xbody = iv_xbody
        iv_find = `<EV_HEX>` iv_len = 60 ) ).
  ENDMETHOD.
  METHOD s1_cdata_utf8.
    go( iv_ctype = `text/xml; charset=utf-8` iv_body = text( ) ).
  ENDMETHOD.
  METHOD s2_cdata_latin1.
    go( iv_ctype = `text/xml; charset=iso-8859-1` iv_body = text( ) ).
  ENDMETHOD.
  METHOD s3_cdata_no_charset.
    go( iv_ctype = `text/xml` iv_body = text( ) ).
  ENDMETHOD.
  METHOD s4_cdata_latin1_after.
    go( iv_ctype = `text/xml; charset=iso-8859-1` iv_after = abap_true iv_body = text( ) ).
  ENDMETHOD.
  METHOD c1_data_utf8_bytes_latin1_hdr.
    go( iv_ctype = `text/xml; charset=iso-8859-1` iv_xbody = cl_abap_codepage=>convert_to( text( ) ) ).
  ENDMETHOD.
  METHOD c3_data_utf8_bytes_utf8_hdr.
    go( iv_ctype = `text/xml; charset=utf-8` iv_xbody = cl_abap_codepage=>convert_to( text( ) ) ).
  ENDMETHOD.
ENDCLASS.
