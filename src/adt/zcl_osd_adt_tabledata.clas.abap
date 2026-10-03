CLASS zcl_osd_adt_tabledata DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_field,
      name TYPE string, camel TYPE string, has_camel TYPE abap_bool,
      description TYPE string, letter TYPE string, data_type TYPE string,
      length TYPE string, decimals TYPE string, key TYPE abap_bool,
    END OF ty_field.
    TYPES tt_field TYPE STANDARD TABLE OF ty_field WITH DEFAULT KEY.
    CLASS-METHODS document IMPORTING io_json TYPE REF TO zcl_ajson
      it_fields TYPE tt_field OPTIONAL iv_name TYPE string OPTIONAL
      iv_has_name TYPE abap_bool DEFAULT abap_false
      iv_cds TYPE abap_bool DEFAULT abap_false iv_camel TYPE abap_bool DEFAULT abap_false
      iv_max_link TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_osd_adt.
  PRIVATE SECTION.
    CLASS-METHODS metadata IMPORTING iv_name TYPE string iv_letter TYPE string it_fields TYPE tt_field
      RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS columns IMPORTING io_json TYPE REF TO zcl_ajson it_fields TYPE tt_field
      RETURNING VALUE(rv_xml) TYPE string RAISING zcx_osd_adt.
ENDCLASS.
CLASS zcl_osd_adt_tabledata IMPLEMENTATION.
  METHOD metadata.
    DATA ls_field TYPE ty_field.
    DATA lv_name TYPE string.
    DATA lv_key TYPE string.
    DATA lv_len TYPE string.
    lv_name = to_upper( iv_name ).
    READ TABLE it_fields INTO ls_field WITH KEY name = lv_name.
    IF sy-subrc <> 0.
      rv_xml = `dataPreview:type="` && iv_letter && `" dataPreview:description="`
        && zcl_osd_adt_xml=>esc( lv_name ) && `" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false"`.
      RETURN.
    ENDIF.
    IF ls_field-has_camel = abap_true.
      rv_xml = `dataPreview:camelCaseName="` && zcl_osd_adt_xml=>esc( ls_field-camel ) && `" `.
    ENDIF.
    IF ls_field-description IS INITIAL.
      ls_field-description = ls_field-name.
    ENDIF.
    lv_key = `false`.
    IF ls_field-key = abap_true.
      lv_key = `true`.
    ENDIF.
    lv_len = ls_field-length.
    IF lv_len IS INITIAL.
      lv_len = `0`.
    ENDIF.
    CONDENSE lv_len NO-GAPS.
    rv_xml = rv_xml && `dataPreview:type="` && zcl_osd_adt_xml=>esc( ls_field-letter )
      && `" dataPreview:description="` && zcl_osd_adt_xml=>esc( ls_field-description )
      && `" dataPreview:keyAttribute="` && lv_key && `" dataPreview:colType="`
      && zcl_osd_adt_xml=>esc( ls_field-data_type )
      && `" dataPreview:isKeyFigure="false" dataPreview:length="` && lv_len && `" dataPreview:caseSensitive="false"`.
  ENDMETHOD.
  METHOD columns.
    DATA lt_columns TYPE string_table.
    DATA lt_cells TYPE string_table.
    DATA lv_index TYPE string.
    DATA lv_position TYPE i.
    DATA lv_path TYPE string.
    DATA lv_name TYPE string.
    DATA lv_letter TYPE string.
    DATA lv_cell TYPE string.
    DATA lv_cell_index TYPE string.
    DATA lv_cell_position TYPE i.
    DATA lv_nl TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_nl = cl_abap_char_utilities=>newline.
    TRY.
        lt_columns = io_json->members( `/columns` ).
        DO lines( lt_columns ) TIMES.
          lv_position = sy-index.
          lv_index = sy-index.
          CONDENSE lv_index NO-GAPS.
          lv_path = `/columns/` && lv_index && `/`.
          lv_name = io_json->get_string( lv_path && `upper` ).
          lv_letter = io_json->get_string( lv_path && `letter` ).
          IF lv_position > 1.
            rv_xml = rv_xml && lv_nl.
          ENDIF.
          rv_xml = rv_xml && `  <dataPreview:columns>` && lv_nl
            && `    <dataPreview:metadata dataPreview:name="` && zcl_osd_adt_xml=>esc( lv_name ) && `" `
            && metadata( iv_name = lv_name iv_letter = lv_letter it_fields = it_fields ) && `/>` && lv_nl
            && `    <dataPreview:dataSet>` && lv_nl.
          lt_cells = io_json->array_to_string_table( lv_path && `cells` ).
          DO lines( lt_cells ) TIMES.
            lv_cell_position = sy-index.
            lv_cell_index = sy-index.
            CONDENSE lv_cell_index NO-GAPS.
            lv_cell = io_json->get_string( lv_path && `cells/` && lv_cell_index ).
            IF lv_cell_position > 1.
              rv_xml = rv_xml && lv_nl.
            ENDIF.
            rv_xml = rv_xml && `      <dataPreview:data>` && zcl_osd_adt_xml=>esc( lv_cell ) && `</dataPreview:data>`.
          ENDDO.
          rv_xml = rv_xml && lv_nl && `    </dataPreview:dataSet>` && lv_nl && `  </dataPreview:columns>`.
        ENDDO.
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid SQL cells` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD document.
    DATA lv_nl TYPE string.
    DATA lv_count TYPE string.
    DATA lv_ms TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    lv_count = io_json->get_string( `/count` ).
    lv_ms = io_json->get_string( `/ms` ).
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">` && lv_nl
      && `  <dataPreview:totalRows>` && lv_count && `</dataPreview:totalRows>`.
    IF iv_has_name = abap_true.
      rv_xml = rv_xml && lv_nl && `  <dataPreview:name>` && zcl_osd_adt_xml=>esc( iv_name ) && `</dataPreview:name>`.
    ENDIF.
    rv_xml = rv_xml && lv_nl.
    IF iv_cds = abap_true.
      rv_xml = rv_xml && lv_nl && `  <dataPreview:cdsEntityName>` && zcl_osd_adt_xml=>esc( iv_name ) && `</dataPreview:cdsEntityName>`.
    ENDIF.
    IF iv_camel = abap_true.
      rv_xml = rv_xml && lv_nl && `  <dataPreview:cdsCamelCaseName>` && zcl_osd_adt_xml=>esc( iv_name ) && `</dataPreview:cdsCamelCaseName>`.
    ENDIF.
    rv_xml = rv_xml && lv_nl && `  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>`.
    IF iv_max_link = abap_true.
      rv_xml = rv_xml && lv_nl && `  <atom:link rel="http://www.sap.com/adt/categories/datapreview/cds/metadata/maxrows" title="Max Rows Increase" xmlns:atom="http://www.w3.org/2005/Atom"/>`.
    ENDIF.
    rv_xml = rv_xml && lv_nl && `  <dataPreview:executedQueryString>`
      && zcl_osd_adt_xml=>esc( io_json->get_string( `/sql` ) ) && `</dataPreview:executedQueryString>` && lv_nl
      && `  <dataPreview:queryExecutionTime>` && lv_ms && `</dataPreview:queryExecutionTime>` && lv_nl
      && columns( io_json = io_json it_fields = it_fields ) && lv_nl && `</dataPreview:tableData>` && lv_nl.
  ENDMETHOD.
ENDCLASS.
