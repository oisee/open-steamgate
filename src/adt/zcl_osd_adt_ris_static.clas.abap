"! Static repository information-system and package editor documents.
CLASS zcl_osd_adt_ris_static DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.

CLASS zcl_osd_adt_ris_static IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lt_items TYPE zcl_osd_adt_doc_common=>tt_item.
    DATA ls_item TYPE zcl_osd_adt_doc_common=>ty_item.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lt_facets TYPE string_table.
    DATA lv_facet TYPE string.
    DATA lv_title TYPE string.

*   These public vocabularies are the same for every resolved session.
*   Dispatch uses the matched pattern, never the request path's case.
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8`.
    CASE is_request-pattern.
      WHEN `/sap/bc/adt/repository/informationsystem/virtualfolders/facets`.
        rs_response-content_type = `application/vnd.sap.adt.facets.v1+xml; charset=utf-8`.
        SPLIT `package group type api fav` AT space INTO TABLE lt_facets.
        rs_response-body = `<?xml version="1.0" encoding="utf-8"?>`
          && `<vf:facets xmlns:vf="http://www.sap.com/adt/ris/facets">`.
        LOOP AT lt_facets INTO lv_facet.
          lv_title = to_upper( lv_facet(1) ) && substring( val = lv_facet off = 1 ).
          rs_response-body = rs_response-body && `<vf:facet key="` && lv_facet
            && `" displayName="` && lv_title && `" description="` && lv_facet
            && `" isHierarchical="false" isForFiltering="true" isForStructuring="true"/>`.
        ENDLOOP.
        rs_response-body = rs_response-body && `</vf:facets>`.
        RETURN.
      WHEN `/sap/bc/adt/packages/settings`.
        rs_response-content_type = `application/vnd.sap.adt.packages.settings+xml; charset=utf-8`.
        rs_response-body = `<?xml version="1.0" encoding="utf-8"?>`
          && `<pkcs:settings pkcs:showPackageCheckErrors="false" xmlns:pkcs="http://www.sap.com/adt/packages/settings"/>`.
        RETURN.
      WHEN `/sap/bc/adt/repository/informationsystem/objecttypes`.
        lt_types = zcl_osd_adt_types=>all( ).
        LOOP AT lt_types INTO ls_type.
          CLEAR ls_item.
          ls_item-name = ls_type-type.
          ls_item-description = ls_type-plural.
          ls_item-data = `type:` && ls_type-adt_type && `;usedBy:quick_search,virtual_folders`.
          ls_item-has_data = abap_true.
          APPEND ls_item TO lt_items.
        ENDLOOP.
      WHEN `/sap/bc/adt/packages/valuehelps/:what`.
        READ TABLE is_request-params INTO ls_param WITH KEY name = `what`.
        IF ls_param-value = `abaplanguageversions`.
          ls_item-name = `standard`.
          ls_item-description = `Standard ABAP`.
          APPEND ls_item TO lt_items.
        ENDIF.
    ENDCASE.
    rs_response-body = zcl_osd_adt_doc_common=>named_items( lt_items ).
  ENDMETHOD.
ENDCLASS.
