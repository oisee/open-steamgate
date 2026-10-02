CLASS ltcl_static DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS settings FOR TESTING RAISING cx_static_check.
    METHODS facets FOR TESTING RAISING cx_static_check.
    METHODS objecttypes FOR TESTING RAISING cx_static_check.
    METHODS empty_lists FOR TESTING RAISING cx_static_check.
    METHODS valuehelps FOR TESTING RAISING cx_static_check.
    METHODS package_precedence FOR TESTING RAISING cx_static_check.
    METHODS answer IMPORTING iv_pattern TYPE string iv_what TYPE string OPTIONAL
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response RAISING zcx_osd_adt.
ENDCLASS.
CLASS ltcl_static IMPLEMENTATION.
  METHOD answer.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    CREATE OBJECT li_route TYPE zcl_osd_adt_ris_static.
    ls_request-pattern = `/sap/bc/adt/` && iv_pattern.
    ls_request-session-user = `DEMO`.
    ls_param-name = `what`.
    ls_param-value = iv_what.
    APPEND ls_param TO ls_request-params.
    rs_response = li_route->handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = rs_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_initial( rs_response-headers ).
    cl_abap_unit_assert=>assert_initial( rs_response-continuation ).
  ENDMETHOD.
  METHOD settings.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    ls_response = answer( `packages/settings` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.adt.packages.settings+xml; charset=utf-8` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
      exp = `<?xml version="1.0" encoding="utf-8"?><pkcs:settings pkcs:showPackageCheckErrors="false" xmlns:pkcs="http://www.sap.com/adt/packages/settings"/>` ).
  ENDMETHOD.
  METHOD facets.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    ls_response = answer( `repository/informationsystem/virtualfolders/facets` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.adt.facets.v1+xml; charset=utf-8` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
      exp = `<?xml version="1.0" encoding="utf-8"?><vf:facets xmlns:vf="http://www.sap.com/adt/ris/facets">`
      && `<vf:facet key="package" displayName="Package" description="package" isHierarchical="false" isForFiltering="true" isForStructuring="true"/>`
      && `<vf:facet key="group" displayName="Group" description="group" isHierarchical="false" isForFiltering="true" isForStructuring="true"/>`
      && `<vf:facet key="type" displayName="Type" description="type" isHierarchical="false" isForFiltering="true" isForStructuring="true"/>`
      && `<vf:facet key="api" displayName="Api" description="api" isHierarchical="false" isForFiltering="true" isForStructuring="true"/>`
      && `<vf:facet key="fav" displayName="Fav" description="fav" isHierarchical="false" isForFiltering="true" isForStructuring="true"/></vf:facets>` ).
  ENDMETHOD.
  METHOD objecttypes.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lv_count TYPE i.
    ls_response = answer( `repository/informationsystem/objecttypes` ).
    FIND ALL OCCURRENCES OF `<nameditem:namedItem>` IN ls_response-body MATCH COUNT lv_count.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 15 ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_response-body
      exp = `*<nameditem:name>CLAS</nameditem:name>*type:CLAS/OC;usedBy:quick_search,virtual_folders*` ).
  ENDMETHOD.
  METHOD empty_lists.
    DATA ls_release TYPE zif_osd_adt_route=>ty_response.
    DATA ls_property TYPE zif_osd_adt_route=>ty_response.
    DATA lt_empty TYPE zcl_osd_adt_doc_common=>tt_item.
    ls_release = answer( `repository/informationsystem/releasestates` ).
    ls_property = answer( `repository/informationsystem/objectproperties/values` ).
    cl_abap_unit_assert=>assert_equals( act = ls_release-body exp = zcl_osd_adt_doc_common=>named_items( lt_empty ) ).
    cl_abap_unit_assert=>assert_equals( act = ls_property exp = ls_release ).
  ENDMETHOD.
  METHOD valuehelps.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_empty TYPE zcl_osd_adt_doc_common=>tt_item.
    ls_response = answer( iv_pattern = `packages/valuehelps/:what` iv_what = `abaplanguageversions` ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_response-body
      exp = `*<nameditem:name>standard</nameditem:name><nameditem:description>Standard ABAP</nameditem:description>*` ).
    ls_response = answer( iv_pattern = `packages/valuehelps/:what` iv_what = `ABAPLANGUAGEVERSIONS` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = zcl_osd_adt_doc_common=>named_items( lt_empty ) ).
  ENDMETHOD.
  METHOD package_precedence.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    DATA ls_route TYPE zcl_osd_adt_router=>ty_route.
    DATA lv_found TYPE abap_bool.
    lt_routes = zcl_osd_adt_router=>routes( ).
*   Add the later slice's generic package row to prove static precedence.
    ls_route-method = `GET`.
    ls_route-pattern = `/sap/bc/adt/packages/:name`.
    ls_route-handler = `PACKAGE`.
    ls_route-served_by = `ABAP`.
    INSERT ls_route INTO lt_routes INDEX lines( lt_routes ).
    zcl_osd_adt_router=>match( EXPORTING it_routes = lt_routes iv_method = `HEAD`
      iv_path = `/SAP/BC/ADT/PACKAGES/SETTINGS` IMPORTING ev_found = lv_found es_route = ls_route ).
    cl_abap_unit_assert=>assert_true( lv_found ).
    cl_abap_unit_assert=>assert_equals( act = ls_route-handler exp = `ZCL_OSD_ADT_RIS_STATIC` ).
  ENDMETHOD.
ENDCLASS.
