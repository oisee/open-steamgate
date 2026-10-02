CLASS ltcl_xml DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS escaping FOR TESTING.
    METHODS fallback FOR TESTING.
    METHODS accept_dataname FOR TESTING.
ENDCLASS.
CLASS ltcl_xml IMPLEMENTATION.
  METHOD escaping.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_xml=>esc( `&<>"'` ) exp = `&amp;&lt;&gt;&quot;'` ).
  ENDMETHOD.
  METHOD fallback.
    DATA lt_headers TYPE tihttpnvp.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_adt_xml=>as_xml_type( it_headers = lt_headers iv_fallback = `default.name` )
      exp = `application/vnd.sap.as+xml; charset=utf-8; dataname=default.name` ).
  ENDMETHOD.
  METHOD accept_dataname.
    DATA lt_headers TYPE tihttpnvp.
    DATA ls_header TYPE ihttpnvp.
    ls_header-name = `aCcEpT`.
    ls_header-value = `application/vnd.sap.as+xml; dataname=foo.bar; dataname=second`.
    APPEND ls_header TO lt_headers.
    ls_header-name = `accept`.
    ls_header-value = `dataname=third`.
    APPEND ls_header TO lt_headers.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_adt_xml=>as_xml_type( it_headers = lt_headers iv_fallback = `default.name` )
      exp = `application/vnd.sap.as+xml; charset=utf-8; dataname=foo.bar` ).
  ENDMETHOD.
ENDCLASS.
