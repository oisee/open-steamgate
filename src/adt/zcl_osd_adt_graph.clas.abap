"! GET and HEAD /sap/bc/adt/compatibility/graph: the logon probe, and the
"! feature graph a client reads before discovery.
"!
"! The data is the Node facade's COMPATIBILITY and COMPATIBILITY_EDGES
"! (tools/adt-facade.mjs), in the same order; the reasons for each node are
"! written there and not repeated here. The document is byte-equal to
"! compatibilityGraphDocument (Gate 1, test/adt-abap-diff.mjs).
"!
"! HEAD has its own row in the route table, as in the Node facade: an empty
"! 200 typed application/xml without a charset, because a client fetches
"! its token with HEAD and the GET body is not sent.
CLASS zcl_osd_adt_graph DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS document
      RETURNING VALUE(rv_xml) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS nodes
      RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS node
      IMPORTING iv_space      TYPE string
                iv_names      TYPE string
      RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS edge
      IMPORTING iv_source_space TYPE string
                iv_source       TYPE string
                iv_target_space TYPE string
                iv_target       TYPE string
                iv_obligatory   TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(rv_xml)   TYPE string.
    CLASS-METHODS edges
      RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_graph IMPLEMENTATION.

  METHOD zif_osd_adt_route~handle.
    rs_response-status = 200.
    IF is_request-method = `HEAD`.
      rs_response-content_type = `application/xml`.
      RETURN.
    ENDIF.
    rs_response-content_type = `application/xml; charset=utf-8`.
    rs_response-body = document( ).
  ENDMETHOD.

  METHOD document.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<compatibility:graph xmlns:compatibility="http://www.sap.com/adt/compatibility">`
      && `<nodes>` && nodes( ) && `</nodes><edges>` && edges( ) && `</edges>`
      && `</compatibility:graph>` && lv_nl.
  ENDMETHOD.

  METHOD node.
*   one namespace, its feature names separated by blanks
    DATA lt_names TYPE string_table.
    DATA lv_name TYPE string.
    SPLIT iv_names AT ` ` INTO TABLE lt_names.
    LOOP AT lt_names INTO lv_name.
      rv_xml = rv_xml && `<node nameSpace="` && iv_space && `" name="` && lv_name && `"/>`.
    ENDLOOP.
  ENDMETHOD.

  METHOD nodes.
    DATA lv_functions TYPE string.
    DATA lv_oo TYPE string.
    lv_functions = `fmodulesSignatureEditable functionGroupIncludes functionGroupIncludesXmlSchemaConform `
      && `functionGroups functionModules functionModulesXmlSchemaConform functions`.
    lv_oo = `classModelXmlSchemaConform classes interfaces interfacesModelXmlSchemaConform `
      && `startUriAdaptationToMainResource`.
    rv_xml = node( iv_space = `COM.SAP.ADT.COMPATIBILITY` iv_names = `compatibilityAvailable` )
      && node( iv_space = `COM.SAP.ADT.ABAPUNIT` iv_names = `abapunit uriBasedAbapUnit xmlVersion2` )
      && node( iv_space = `COM.SAP.ADT.SAPGUI` iv_names = `navigationEvents reentranceTickets sapguiForWindows` )
      && node( iv_space = `COM.SAP.ADT.ACTIVATION` iv_names = `activate check` )
      && node( iv_space = `COM.SAP.ADT.CORE` iv_names = `checkruns checkrunsVendorContentType xmlFormat xmlNameSpace` )
      && node( iv_space = `COM.SAP.ADT.DDIC` iv_names = `ddic` )
      && node( iv_space = `COM.SAP.ADT.DDIC.DDLSOURCES` iv_names = `ddlSources` )
      && node( iv_space = `COM.SAP.ADT.DDIC.VIEWS` iv_names = `views` )
      && node( iv_space = `COM.SAP.ADT.FUNCTIONS`
               iv_names = lv_functions )
      && node( iv_space = `COM.SAP.ADT.OO`
               iv_names = lv_oo )
      && node( iv_space = `COM.SAP.ADT.PROGRAMS` iv_names = `includes includesXmlSchemaConform programs programsXmlSchemaConform` )
      && node( iv_space = `COM.SAP.ADT.PROJECTEXPLORER` iv_names = `fullRepositoryTree repositoryQueryService typeMetaData` )
      && node( iv_space = `COM.SAP.ADT.RIS` iv_names = `ris search` )
      && node( iv_space = `COM.SAP.ADT.SOURCESERVICES` iv_names = `outline` ).
  ENDMETHOD.

  METHOD edge.
    DATA lv_obligatory TYPE string.
    IF iv_obligatory = abap_true.
      lv_obligatory = `true`.
    ELSE.
      lv_obligatory = `false`.
    ENDIF.
    rv_xml = `<edge isObligatory="` && lv_obligatory && `">`
      && `<sourceNode nameSpace="` && iv_source_space && `" name="` && iv_source && `"/>`
      && `<targetNode nameSpace="` && iv_target_space && `" name="` && iv_target && `"/>`
      && `</edge>`.
  ENDMETHOD.

  METHOD edges.
    CONSTANTS lc_unit TYPE string VALUE `COM.SAP.ADT.ABAPUNIT`.
    CONSTANTS lc_core TYPE string VALUE `COM.SAP.ADT.CORE`.
    CONSTANTS lc_fn TYPE string VALUE `COM.SAP.ADT.FUNCTIONS`.
    CONSTANTS lc_oo TYPE string VALUE `COM.SAP.ADT.OO`.
    CONSTANTS lc_prog TYPE string VALUE `COM.SAP.ADT.PROGRAMS`.
    CONSTANTS lc_ris TYPE string VALUE `COM.SAP.ADT.RIS`.

    rv_xml = edge( iv_source_space = lc_unit iv_source = `abapunit` iv_target_space = lc_unit iv_target = `uriBasedAbapUnit` )
      && edge( iv_source_space = lc_unit iv_source = `abapunit` iv_target_space = lc_unit iv_target = `xmlVersion2` )
      && edge( iv_source_space = `COM.SAP.ADT.ACTIVATION` iv_source = `activate` iv_target_space = lc_core iv_target = `xmlFormat` )
      && edge( iv_source_space = lc_core iv_source = `checkruns` iv_target_space = lc_core iv_target = `checkrunsVendorContentType` )
      && edge( iv_source_space = lc_core iv_source = `xmlFormat` iv_target_space = lc_core iv_target = `xmlNameSpace` )
      && edge( iv_source_space = lc_fn iv_source = `functionGroupIncludes`
               iv_target_space = lc_fn iv_target = `functionGroupIncludesXmlSchemaConform` )
      && edge( iv_source_space = lc_fn iv_source = `functionModules` iv_target_space = lc_fn iv_target = `fmodulesSignatureEditable` )
      && edge( iv_source_space = lc_fn iv_source = `functionModules`
               iv_target_space = lc_fn iv_target = `functionModulesXmlSchemaConform` )
      && edge( iv_source_space = lc_fn iv_source = `functions` iv_target_space = lc_fn iv_target = `fmodulesSignatureEditable` )
      && edge( iv_source_space = lc_fn iv_source = `functions` iv_target_space = lc_fn iv_target = `functionGroupIncludes` )
      && edge( iv_source_space = lc_fn iv_source = `functions` iv_target_space = lc_fn iv_target = `functionGroups`
               iv_obligatory = abap_false )
      && edge( iv_source_space = lc_fn iv_source = `functions` iv_target_space = lc_fn iv_target = `functionModules` )
      && edge( iv_source_space = lc_oo iv_source = `classes` iv_target_space = lc_oo iv_target = `classModelXmlSchemaConform` )
      && edge( iv_source_space = lc_oo iv_source = `classes` iv_target_space = lc_oo iv_target = `startUriAdaptationToMainResource` )
      && edge( iv_source_space = lc_oo iv_source = `interfaces` iv_target_space = lc_oo iv_target = `interfacesModelXmlSchemaConform` )
      && edge( iv_source_space = lc_oo iv_source = `interfaces` iv_target_space = lc_oo iv_target = `startUriAdaptationToMainResource` )
      && edge( iv_source_space = lc_prog iv_source = `includes` iv_target_space = lc_prog iv_target = `includesXmlSchemaConform` )
      && edge( iv_source_space = lc_prog iv_source = `programs` iv_target_space = lc_prog iv_target = `programsXmlSchemaConform` )
      && edge( iv_source_space = lc_ris iv_source = `ris` iv_target_space = lc_ris iv_target = `search` ).
  ENDMETHOD.

ENDCLASS.
