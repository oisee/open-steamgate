CLASS ltcl_request_xml DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS expanded_names FOR TESTING RAISING cx_static_check.
    METHODS depth_boundary FOR TESTING RAISING cx_static_check.
    METHODS invalid_before_dispatch FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_request_xml IMPLEMENTATION.
  METHOD expanded_names.
    DATA lv_a TYPE string.
    DATA lv_b TYPE string.
    lv_a = zcl_osd_adt_request_xml=>read( cl_abap_codepage=>convert_to(
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/x"/></adtcore:objectReferences>` ) ).
    lv_b = zcl_osd_adt_request_xml=>read( cl_abap_codepage=>convert_to(
      `<objectReferences xmlns='http://www.sap.com/adt/core' xmlns:r='http://www.sap.com/adt/core'><objectReference r:uri='/x'/></objectReferences>` ) ).
    cl_abap_unit_assert=>assert_equals( act = lv_b exp = lv_a ).
  ENDMETHOD.
  METHOD depth_boundary.
    DATA lv_xml TYPE string.
    DATA lv_result TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_xml = `<root>`.
    DO 63 TIMES.
      lv_xml = lv_xml && `<n>`.
    ENDDO.
    DO 63 TIMES.
      lv_xml = lv_xml && `</n>`.
    ENDDO.
    lv_xml = lv_xml && `</root>`.
    lv_result = zcl_osd_adt_request_xml=>read( cl_abap_codepage=>convert_to( lv_xml ) ).
    cl_abap_unit_assert=>assert_equals( act = lv_result exp = lv_xml ).
    TRY.
        lv_result = zcl_osd_adt_request_xml=>read( cl_abap_codepage=>convert_to( `<n>` && lv_xml && `</n>` ) ).
        cl_abap_unit_assert=>fail( `65 levels accepted` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 400 ).
    ENDTRY.
  ENDMETHOD.
  METHOD invalid_before_dispatch.
    DATA lt_bad TYPE string_table.
    DATA lv_bad TYPE string.
    DATA lv_result TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    APPEND `not XML` TO lt_bad.
    APPEND `<r:objectReferences/>` TO lt_bad.
    APPEND `<r:objectReferences xmlns:r="urn:foreign"/>` TO lt_bad.
    APPEND `<a><b></a>` TO lt_bad.
    APPEND `<a/>tail` TO lt_bad.
    APPEND `<a/><b/>` TO lt_bad.
    APPEND `<!DOCTYPE a SYSTEM "http://127.0.0.1/entity"><a/>` TO lt_bad.
    APPEND `<a x="1" x="2"/>` TO lt_bad.
    LOOP AT lt_bad INTO lv_bad.
      TRY.
          lv_result = zcl_osd_adt_request_xml=>read( cl_abap_codepage=>convert_to( lv_bad ) ).
          cl_abap_unit_assert=>fail( `invalid XML accepted` ).
        CATCH zcx_osd_adt INTO lx_error.
          cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 400 ).
          cl_abap_unit_assert=>assert_equals( act = lx_error->type_id exp = `ExceptionInvalidXML` ).
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
