CLASS ltcl_feeds DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS clock FOR TESTING.
    METHODS routes FOR TESTING RAISING zcx_osd_adt.
ENDCLASS.
CLASS ltcl_feeds IMPLEMENTATION.
  METHOD clock.
    DATA lv_iso TYPE string.
    lv_iso = zcl_osd_adt_feeds=>now_iso( ).
    cl_abap_unit_assert=>assert_equals( act = strlen( lv_iso ) exp = 24 ).
    lv_iso = zcl_osd_adt_feeds=>iso( '20261003123456.9980000' ).
    cl_abap_unit_assert=>assert_equals( act = lv_iso exp = `2026-10-03T12:34:56.998Z` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_feeds=>milliseconds( '0.9999999' ) exp = `999` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_feeds=>milliseconds( '0.9995000' ) exp = `999` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_feeds=>c_atom
      exp = `application/atom+xml; charset=utf-8; type=feed` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_transport=>c_type
      exp = `application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData` ).
  ENDMETHOD.
  METHOD routes.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_object TYPE zcl_osd_adt_types=>ty_object.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CREATE OBJECT li_route TYPE zcl_osd_adt_transport.
    ls_response = li_route->handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type exp = zcl_osd_adt_transport=>c_type ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_response-body exp = `*<DEVCLASS>$TMP</DEVCLASS>*` ).
    ls_object = zcl_osd_adt_types=>object_from_uri( iv_uri = `/sap/bc/adt/oo/classes/x/source/main?version=a#start=1`
      iv_sources_only = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_object-name exp = `X` ).
    ls_object = zcl_osd_adt_types=>object_from_uri( iv_uri = `/sap/bc/adt/packages/x` iv_sources_only = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_object-found exp = abap_false ).
    ls_object = zcl_osd_adt_types=>object_from_uri( iv_uri = `/sap/bc/adt/oo/classes/%FF` iv_sources_only = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_object-ok exp = abap_false ).
    CREATE OBJECT li_route TYPE zcl_osd_adt_occurrences.
    ls_request-uri = `/sap/bc/adt/abapsource/occurencemarkers?uri=%`.
    ls_response = li_route->handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type exp = `application/xml; charset=utf-8` ).
    ls_request-uri = `/sap/bc/adt/abapsource/occurencemarkers?uri=a&uri=b`.
    TRY.
        li_route->handle( ls_request ).
        cl_abap_unit_assert=>fail( ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 400 ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
