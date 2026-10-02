"! Bulk STORE facts; request selection, tree counts and XML belong to ABAP.
CLASS zcl_osd_adt_vfs DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS response IMPORTING iv_body TYPE string RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
    CLASS-METHODS document IMPORTING iv_xml TYPE string RETURNING VALUE(rv_body) TYPE string RAISING zcx_osd_adt.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_package,
             name TYPE string,
             parent TYPE string,
             description TYPE string,
             library TYPE string,
             root TYPE string,
           END OF ty_package.
    TYPES: BEGIN OF ty_edge,
             parent TYPE string,
             child TYPE string,
           END OF ty_edge.
    TYPES: BEGIN OF ty_object,
             package TYPE string,
             type TYPE string,
             name TYPE string,
             description TYPE string,
             library TYPE string,
           END OF ty_object.
    TYPES: BEGIN OF ty_selection,
             facet TYPE string,
             values TYPE string_table,
           END OF ty_selection.
    TYPES: BEGIN OF ty_count,
             value TYPE string,
             count TYPE i,
             key TYPE string,
           END OF ty_count.
    DATA mt_packages TYPE HASHED TABLE OF ty_package WITH UNIQUE KEY name.
    DATA mt_edges TYPE STANDARD TABLE OF ty_edge WITH DEFAULT KEY.
    DATA mt_objects TYPE STANDARD TABLE OF ty_object WITH DEFAULT KEY.
    DATA mt_selection TYPE STANDARD TABLE OF ty_selection WITH DEFAULT KEY.
    DATA mt_selected TYPE string_table.
    DATA mt_values TYPE string_table.
    DATA mt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA mv_facet TYPE string.
    DATA mv_one TYPE string.
    CONSTANTS c_atom TYPE string VALUE ` xmlns:atom="http://www.w3.org/2005/Atom"`.
    CONSTANTS c_rel TYPE string VALUE `http://www.sap.com/adt/relations/informationsystem/virtualfolders/selection`.
    METHODS load RAISING zcx_osd_adt.
    METHODS request IMPORTING iv_xml TYPE string.
    METHODS filter IMPORTING iv_pattern TYPE string.
    METHODS members IMPORTING iv_value TYPE string RETURNING VALUE(rt_names) TYPE string_table.
    METHODS children IMPORTING iv_name TYPE string RETURNING VALUE(rt_names) TYPE string_table.
    METHODS facet_value IMPORTING is_object TYPE ty_object iv_facet TYPE string RETURNING VALUE(rv_value) TYPE string.
    METHODS label IMPORTING iv_value TYPE string RETURNING VALUE(rv_label) TYPE string.
    METHODS render RETURNING VALUE(rv_body) TYPE string.
    METHODS objects RETURNING VALUE(rv_body) TYPE string.
    METHODS packages RETURNING VALUE(rv_body) TYPE string.
    METHODS drawers RETURNING VALUE(rv_body) TYPE string.
    METHODS package_drawer IMPORTING iv_value TYPE string RETURNING VALUE(rv_body) TYPE string.
    METHODS link IMPORTING it_parts TYPE string_table RETURNING VALUE(rv_link) TYPE string.
    METHODS uri IMPORTING iv_type TYPE string iv_name TYPE string RETURNING VALUE(rv_uri) TYPE string.
    METHODS count_in IMPORTING it_names TYPE string_table RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.
CLASS zcl_osd_adt_vfs IMPLEMENTATION.
  METHOD document.
    DATA lo_vfs TYPE REF TO zcl_osd_adt_vfs.
    CREATE OBJECT lo_vfs.
    lo_vfs->load( ).
    lo_vfs->request( iv_xml ).
    rv_body = lo_vfs->render( ).
  ENDMETHOD.
  METHOD load.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lt_lines TYPE string_table.
    DATA lv_line TYPE string.
    DATA lv_kind TYPE string.
    DATA lv_a TYPE string.
    DATA lv_b TYPE string.
    DATA lv_c TYPE string.
    DATA lv_d TYPE string.
    DATA lv_e TYPE string.
    DATA ls_package TYPE ty_package.
    DATA ls_edge TYPE ty_edge.
    DATA ls_object TYPE ty_object.
    zcl_osd_adt_host=>require( `PACKAGES` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PACKAGES` iv_json = `{"format":"vfs-lines"}` ).
    SPLIT ls_answer-source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line WHERE table_line IS NOT INITIAL.
      SPLIT lv_line AT cl_abap_char_utilities=>horizontal_tab INTO lv_kind lv_a lv_b lv_c lv_d lv_e.
      CASE lv_kind.
        WHEN `P`.
          ls_package-name = lv_a.
          ls_package-parent = lv_b.
          ls_package-description = zcl_osd_adt_js=>unescape( lv_c ).
          ls_package-library = lv_d.
          ls_package-root = lv_e.
          INSERT ls_package INTO TABLE mt_packages.
        WHEN `C`.
          ls_edge-parent = lv_a.
          ls_edge-child = lv_b.
          APPEND ls_edge TO mt_edges.
        WHEN `O`.
          ls_object-package = lv_a.
          ls_object-type = lv_b.
          ls_object-name = lv_c.
          ls_object-description = zcl_osd_adt_js=>unescape( lv_d ).
          ls_object-library = lv_e.
          APPEND ls_object TO mt_objects.
      ENDCASE.
    ENDLOOP.
    mt_types = zcl_osd_adt_types=>all( ).
  ENDMETHOD.
  METHOD request.
    DATA lt_blocks TYPE zcl_osd_adt_scan=>tt_block.
    DATA lt_values TYPE zcl_osd_adt_scan=>tt_block.
    DATA ls_block TYPE zcl_osd_adt_scan=>ty_block.
    DATA ls_value TYPE zcl_osd_adt_scan=>ty_block.
    DATA ls_selection TYPE ty_selection.
    DATA lv_found TYPE abap_bool.
    DATA lv_pattern TYPE string.
    DATA lv_values TYPE string.
    FIELD-SYMBOLS <selection> TYPE ty_selection.
    lt_blocks = zcl_osd_adt_scan=>blocks( iv_xml = iv_xml iv_element = `vfs:preselection` ).
    LOOP AT lt_blocks INTO ls_block.
      CLEAR ls_selection.
      zcl_osd_adt_scan=>attribute( EXPORTING iv_xml = ls_block-attributes iv_name = `facet`
        IMPORTING ev_value = ls_selection-facet ev_found = lv_found ).
      IF lv_found = abap_false OR ls_selection-facet IS INITIAL.
        CONTINUE.
      ENDIF.
      ls_selection-facet = to_lower( ls_selection-facet ).
      lt_values = zcl_osd_adt_scan=>blocks( iv_xml = ls_block-content iv_element = `vfs:value` ).
      LOOP AT lt_values INTO ls_value WHERE attributes IS INITIAL.
        IF ls_value-content NA `<`.
          APPEND to_upper( ls_value-content ) TO ls_selection-values.
        ENDIF.
      ENDLOOP.
      READ TABLE mt_selection ASSIGNING <selection> WITH KEY facet = ls_selection-facet.
      IF sy-subrc = 0.
        <selection>-values = ls_selection-values.
      ELSE.
        APPEND ls_selection TO mt_selection.
      ENDIF.
    ENDLOOP.
    LOOP AT mt_selection INTO ls_selection.
      CONCATENATE LINES OF ls_selection-values INTO lv_values SEPARATED BY `,`.
      APPEND ls_selection-facet && `:` && lv_values TO mt_selected.
      IF ls_selection-facet = `package`.
        mt_values = ls_selection-values.
      ENDIF.
    ENDLOOP.
    IF lines( mt_values ) = 1.
      READ TABLE mt_values INTO mv_one INDEX 1.
      IF strlen( mv_one ) >= 2 AND mv_one(2) = `..`.
        CLEAR mv_one.
      ENDIF.
    ENDIF.
    zcl_osd_adt_scan=>first_tag_value( EXPORTING iv_xml = iv_xml iv_tag = `vfs:facet`
      IMPORTING ev_value = mv_facet ).
*   Empty facets are ignored by the Node regex; find the first nonempty one.
    IF mv_facet IS INITIAL.
      lt_blocks = zcl_osd_adt_scan=>blocks( iv_xml = iv_xml iv_element = `vfs:facet` ).
      LOOP AT lt_blocks INTO ls_block WHERE attributes IS INITIAL AND content IS NOT INITIAL.
        IF ls_block-content NA `<`.
          mv_facet = ls_block-content.
          EXIT.
        ENDIF.
      ENDLOOP.
    ENDIF.
    mv_facet = to_lower( mv_facet ).
    zcl_osd_adt_scan=>attribute( EXPORTING iv_xml = iv_xml iv_name = `objectSearchPattern`
      IMPORTING ev_value = lv_pattern ev_found = lv_found ).
    IF lv_found = abap_false OR lv_pattern IS INITIAL.
      lv_pattern = `*`.
    ENDIF.
    filter( to_upper( lv_pattern ) ).
  ENDMETHOD.
  METHOD children.
    DATA ls_edge TYPE ty_edge.
    LOOP AT mt_edges INTO ls_edge WHERE parent = iv_name.
      APPEND ls_edge-child TO rt_names.
    ENDLOOP.
  ENDMETHOD.
  METHOD members.
    DATA lv_name TYPE string.
    DATA lt_children TYPE string_table.
    IF strlen( iv_value ) >= 2 AND iv_value(2) = `..`.
      APPEND substring( val = iv_value off = 2 ) TO rt_names.
      RETURN.
    ENDIF.
    APPEND iv_value TO rt_names.
*   LOOP visits appended rows too, like Node's breadth-first subtree walk.
    LOOP AT rt_names INTO lv_name.
      lt_children = children( lv_name ).
      APPEND LINES OF lt_children TO rt_names.
    ENDLOOP.
  ENDMETHOD.
  METHOD facet_value.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    CASE iv_facet.
      WHEN `package`.
        rv_value = is_object-package.
      WHEN `type`.
        rv_value = is_object-type.
        IF rv_value = `PROG`.
          rv_value = `REPO`.
        ENDIF.
      WHEN `group`.
        IF is_object-type = `DDLS` OR is_object-type = `SRVD` OR is_object-type = `DCLS`.
          rv_value = `CORE_DATA_SERVICES`.
        ELSE.
          READ TABLE mt_types INTO ls_type WITH KEY type = is_object-type.
          rv_value = to_upper( ls_type-tree_category ).
          IF rv_value IS INITIAL.
            rv_value = `OTHER`.
          ENDIF.
        ENDIF.
    ENDCASE.
  ENDMETHOD.
  METHOD filter.
    DATA ls_selection TYPE ty_selection.
    DATA lt_names TYPE string_table.
    DATA lt_members TYPE string_table.
    DATA lv_value TYPE string.
    DATA lv_index TYPE i.
    DATA ls_object TYPE ty_object.
    LOOP AT mt_objects INTO ls_object.
      IF zcl_osd_adt_js=>glob( iv_pattern = iv_pattern iv_text = to_upper( ls_object-name ) ) = abap_false.
        DELETE mt_objects INDEX sy-tabix.
      ENDIF.
    ENDLOOP.
    LOOP AT mt_selection INTO ls_selection.
      lt_names = ls_selection-values.
      IF ls_selection-facet = `package`.
        CLEAR lt_names.
        LOOP AT ls_selection-values INTO lv_value.
          lt_members = members( lv_value ).
          APPEND LINES OF lt_members TO lt_names.
        ENDLOOP.
      ENDIF.
      LOOP AT mt_objects INTO ls_object.
        lv_index = sy-tabix.
        lv_value = facet_value( is_object = ls_object iv_facet = ls_selection-facet ).
        READ TABLE lt_names TRANSPORTING NO FIELDS WITH KEY table_line = lv_value.
        IF sy-subrc <> 0 OR lv_value IS INITIAL.
          DELETE mt_objects INDEX lv_index.
        ENDIF.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.
  METHOD uri.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    READ TABLE mt_types INTO ls_type WITH KEY type = iv_type.
    IF sy-subrc <> 0.
      ls_type-collection = `unknown`.
    ENDIF.
    rv_uri = `/sap/bc/adt/` && ls_type-collection && `/` && zcl_osd_adt_uri=>encode_component( to_lower( iv_name ) ).
  ENDMETHOD.
  METHOD link.
    DATA lv_parts TYPE string.
    CONCATENATE LINES OF it_parts INTO lv_parts SEPARATED BY ` `.
    rv_link = `<atom:link href="/sap/bc/adt/repository/informationsystem/virtualfolders?selection=`
      && zcl_osd_adt_uri=>encode_component( lv_parts ) && `" rel="` && c_rel
      && `" title="Virtual Folder Selection"` && c_atom && `/>`.
  ENDMETHOD.
  METHOD render.
    DATA lv_info TYPE string.
    DATA lv_body TYPE string.
    DATA lt_children TYPE string_table.
    DATA lv_has TYPE string.
    IF mv_one IS NOT INITIAL.
      lt_children = children( mv_one ).
      lv_has = `false`.
      IF lines( lt_children ) > 0.
        lv_has = `true`.
      ENDIF.
      lv_info = `<vfs:preselectionInfo facet="PACKAGE" hasChildrenOfSameFacet="` && lv_has && `"/>`.
    ENDIF.
    IF mv_facet IS INITIAL.
      lv_body = objects( ).
    ELSEIF mv_facet = `package`.
      lv_body = packages( ).
    ELSE.
      lv_body = drawers( ).
    ENDIF.
    rv_body = `<?xml version="1.0" encoding="utf-8"?><vfs:virtualFoldersResult objectCount="`
      && |{ lines( mt_objects ) }| && `" xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders">`
      && lv_info && link( mt_selected ) && lv_body && `</vfs:virtualFoldersResult>`.
  ENDMETHOD.
  METHOD objects.
    DATA ls_object TYPE ty_object.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA lv_uri TYPE string.
    DATA lv_expand TYPE string.
    LOOP AT mt_objects INTO ls_object.
      CLEAR ls_type.
      READ TABLE mt_types INTO ls_type WITH KEY type = ls_object-type.
      lv_uri = uri( iv_type = ls_object-type iv_name = ls_object-name ).
      lv_expand = `false`.
      IF ls_type-source = abap_true.
        lv_expand = `true`.
      ENDIF.
      rv_body = rv_body && `<vfs:object uri="` && lv_uri && `" text="`
        && zcl_osd_adt_xml=>esc( ls_object-description ) && `" name="` && zcl_osd_adt_xml=>esc( ls_object-name )
        && `" package="` && zcl_osd_adt_xml=>esc( ls_object-package ) && `" type="`
        && zcl_osd_adt_types=>adt_type( ls_object-type ) && `" expandable="` && lv_expand && `">`
        && `<atom:link href="` && lv_uri && `" rel="http://www.sap.com/adt/relations/objects"`
        && ` title="ADT Object Reference"` && c_atom && `/></vfs:object>`.
    ENDLOOP.
  ENDMETHOD.
  METHOD count_in.
    DATA ls_object TYPE ty_object.
    LOOP AT mt_objects INTO ls_object.
      READ TABLE it_names TRANSPORTING NO FIELDS WITH KEY table_line = ls_object-package.
      IF sy-subrc = 0.
        rv_count = rv_count + 1.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD packages.
    DATA lt_names TYPE string_table.
    DATA ls_package TYPE ty_package.
    DATA lv_name TYPE string.
    IF mv_one IS NOT INITIAL.
      READ TABLE mt_objects TRANSPORTING NO FIELDS WITH KEY package = mv_one.
      IF sy-subrc = 0.
        rv_body = package_drawer( `..` && mv_one ).
      ENDIF.
      lt_names = children( mv_one ).
      SORT lt_names.
    ELSEIF mt_values IS INITIAL.
      LOOP AT mt_packages INTO ls_package WHERE root = abap_true.
        APPEND ls_package-name TO lt_names.
      ENDLOOP.
      SORT lt_names.
    ELSE.
      lt_names = mt_values.
    ENDIF.
    LOOP AT lt_names INTO lv_name.
      rv_body = rv_body && package_drawer( lv_name ).
    ENDLOOP.
  ENDMETHOD.
  METHOD package_drawer.
    DATA lv_name TYPE string.
    DATA lv_has TYPE string VALUE `false`.
    DATA lv_text TYPE string.
    DATA lv_uri TYPE string.
    DATA lv_part TYPE string.
    DATA ls_package TYPE ty_package.
    DATA lt_parts TYPE string_table.
    DATA lt_names TYPE string_table.
    DATA lv_count TYPE i.
    lv_name = iv_value.
    IF strlen( iv_value ) >= 2 AND iv_value(2) = `..`.
      lv_name = substring( val = iv_value off = 2 ).
      lv_text = `directly assigned objects`.
    ELSE.
      READ TABLE mt_packages INTO ls_package WITH KEY name = lv_name.
      lv_text = ls_package-description.
      lt_names = children( lv_name ).
      IF lines( lt_names ) > 0.
        lv_has = `true`.
      ENDIF.
    ENDIF.
    lt_names = members( iv_value ).
    lv_count = count_in( lt_names ).
    LOOP AT mt_selected INTO lv_part.
      IF strlen( lv_part ) < 8 OR lv_part(8) <> `package:`.
        APPEND lv_part TO lt_parts.
      ENDIF.
    ENDLOOP.
    APPEND `package:` && iv_value TO lt_parts.
    lv_uri = uri( iv_type = `DEVC` iv_name = lv_name ).
    rv_body = `<vfs:virtualFolder hasChildrenOfSameFacet="` && lv_has && `" uri="` && lv_uri
      && `" counter="` && |{ lv_count }| && `" text="` && zcl_osd_adt_xml=>esc( lv_text )
      && `" name="` && zcl_osd_adt_xml=>esc( iv_value ) && `" displayName="`
      && zcl_osd_adt_xml=>esc( iv_value ) && `" facet="PACKAGE">` && link( lt_parts )
      && `<atom:link href="` && lv_uri && `" rel="http://www.sap.com/adt/relations/packages" title="Package"`
      && c_atom && `/></vfs:virtualFolder>`.
  ENDMETHOD.
  METHOD label.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA lv_type TYPE string.
    rv_label = iv_value.
    IF mv_facet = `group`.
      CASE iv_value.
        WHEN `CORE_DATA_SERVICES`.
          rv_label = `Core Data Services`.
        WHEN `UC_OBJECT_TYPE_GROUP`.
          rv_label = `Connectivity`.
        WHEN OTHERS.
          READ TABLE mt_types INTO ls_type WITH KEY tree_category = to_lower( iv_value ).
          IF sy-subrc = 0.
            rv_label = ls_type-tree_category_label.
          ENDIF.
      ENDCASE.
    ELSEIF mv_facet = `type`.
      lv_type = iv_value.
      IF lv_type = `REPO`.
        lv_type = `PROG`.
      ENDIF.
      READ TABLE mt_types INTO ls_type WITH KEY type = lv_type.
      IF sy-subrc = 0.
        rv_label = ls_type-tree_label.
      ENDIF.
    ENDIF.
  ENDMETHOD.
  METHOD drawers.
    DATA lt_counts TYPE STANDARD TABLE OF ty_count WITH DEFAULT KEY.
    DATA ls_count TYPE ty_count.
    DATA ls_object TYPE ty_object.
    DATA lt_parts TYPE string_table.
    DATA lv_value TYPE string.
    FIELD-SYMBOLS <count> TYPE ty_count.
    LOOP AT mt_objects INTO ls_object.
      lv_value = facet_value( is_object = ls_object iv_facet = mv_facet ).
      IF lv_value IS INITIAL.
        CONTINUE.
      ENDIF.
      READ TABLE lt_counts ASSIGNING <count> WITH KEY value = lv_value.
      IF sy-subrc = 0.
        <count>-count = <count>-count + 1.
      ELSE.
        ls_count-value = lv_value.
        ls_count-count = 1.
        ls_count-key = zcl_osd_adt_js=>collate( lv_value ).
        APPEND ls_count TO lt_counts.
      ENDIF.
    ENDLOOP.
    SORT lt_counts BY key.
    LOOP AT lt_counts INTO ls_count.
      lt_parts = mt_selected.
      APPEND mv_facet && `:` && ls_count-value TO lt_parts.
      rv_body = rv_body && `<vfs:virtualFolder hasChildrenOfSameFacet="false" counter="` && |{ ls_count-count }|
        && `" text="" name="` && zcl_osd_adt_xml=>esc( ls_count-value ) && `" displayName="`
        && zcl_osd_adt_xml=>esc( label( ls_count-value ) ) && `" facet="` && to_upper( mv_facet ) && `">`
        && link( lt_parts ) && `</vfs:virtualFolder>`.
    ENDLOOP.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lo_decoder TYPE REF TO cl_abap_conv_in_ce.
    DATA lv_xml TYPE string.
    lo_decoder = cl_abap_conv_in_ce=>create( encoding = `UTF-8` ignore_cerr = abap_true ).
    lo_decoder->convert( EXPORTING input = is_request-body IMPORTING data = lv_xml ).
    rs_response = response( document( lv_xml ) ).
  ENDMETHOD.
  METHOD response.
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8`.
    rs_response-body = iv_body.
  ENDMETHOD.
ENDCLASS.
