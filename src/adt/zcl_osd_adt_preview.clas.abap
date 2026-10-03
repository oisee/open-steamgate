CLASS zcl_osd_adt_preview DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS table_fields IMPORTING iv_name TYPE string iv_type TYPE string DEFAULT `TABL`
      RETURNING VALUE(rt_fields) TYPE zcl_osd_adt_tabledata=>tt_field RAISING zcx_osd_adt.
    CLASS-METHODS cds_fields IMPORTING iv_name TYPE string
      RETURNING VALUE(rt_fields) TYPE zcl_osd_adt_tabledata=>tt_field RAISING zcx_osd_adt.
    CLASS-METHODS metadata IMPORTING it_fields TYPE zcl_osd_adt_tabledata=>tt_field RETURNING VALUE(ro_json) TYPE REF TO zcl_ajson RAISING zcx_osd_adt.
  PRIVATE SECTION.
    CLASS-METHODS base_fields IMPORTING io_head TYPE REF TO zcl_ajson RETURNING VALUE(rt_fields) TYPE zcl_osd_adt_tabledata=>tt_field.
ENDCLASS.
CLASS zcl_osd_adt_preview IMPLEMENTATION.
  METHOD table_fields.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA ls_table TYPE zcl_osd_adt_ddic=>ty_table.
    DATA ls_ddic TYPE zcl_osd_adt_ddic=>ty_field.
    DATA ls_field TYPE zcl_osd_adt_tabledata=>ty_field.
    ls_answer = zcl_osd_adt_host=>store( iv_command = `READ` iv_type = iv_type iv_name = iv_name ).
    ls_table = zcl_osd_adt_ddic=>table_fields( iv_xml = ls_answer-source iv_name = iv_name iv_resolve = abap_true ).
    LOOP AT ls_table-fields INTO ls_ddic.
      CLEAR ls_field.
      ls_field-name = ls_ddic-name.
      ls_field-data_type = ls_ddic-datatype.
      ls_field-letter = ls_ddic-letter.
      ls_field-description = ls_ddic-description.
      ls_field-length = ls_ddic-length.
      ls_field-decimals = ls_ddic-decimals.
      ls_field-key = ls_ddic-key.
      APPEND ls_field TO rt_fields.
    ENDLOOP.
  ENDMETHOD.
  METHOD base_fields.
    DATA lt_sources TYPE string_table.
    DATA lv_source TYPE string.
    TRY.
        lt_sources = io_head->array_to_string_table( `/sources` ).
        IF lines( lt_sources ) <> 1.
          RETURN.
        ENDIF.
        READ TABLE lt_sources INDEX 1 INTO lv_source.
        TRY.
            rt_fields = table_fields( lv_source ).
          CATCH zcx_osd_adt.
            rt_fields = table_fields( iv_name = lv_source iv_type = `VIEW` ).
        ENDTRY.
      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.
  METHOD cds_fields.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_head TYPE REF TO zcl_ajson.
    DATA lt_elements TYPE string_table.
    DATA lt_base TYPE zcl_osd_adt_tabledata=>tt_field.
    DATA ls_field TYPE zcl_osd_adt_tabledata=>ty_field.
    DATA lv_index TYPE string.
    DATA lv_path TYPE string.
    DATA lv_base TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    zcl_osd_adt_host=>require( `PARSE` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PARSE` iv_json = `{"kind":"DDLS","name":` && zcl_osd_adt_json=>quote( iv_name ) && `}` ).
    TRY.
        lo_head = zcl_ajson=>parse( ls_answer-json ).
        IF lo_head->get_boolean( `/found` ) = abap_false.
          lx_error = zcx_osd_adt=>not_found( |DDLS { iv_name } does not exist| ).
          RAISE EXCEPTION lx_error.
        ENDIF.
        lt_base = base_fields( lo_head ).
        lt_elements = lo_head->members( `/elements` ).
        DO lines( lt_elements ) TIMES.
          lv_index = sy-index.
          CONDENSE lv_index NO-GAPS.
          lv_path = `/elements/` && lv_index && `/`.
          lv_base = lo_head->get_string( lv_path && `base` ).
          CLEAR ls_field.
          READ TABLE lt_base INTO ls_field WITH KEY name = lv_base.
          IF sy-subrc <> 0.
            ls_field-letter = `C`.
          ENDIF.
          ls_field-name = lo_head->get_string( lv_path && `name` ).
          ls_field-camel = lo_head->get_string( lv_path && `camelCaseName` ).
          ls_field-has_camel = abap_true.
          ls_field-key = lo_head->get_boolean( lv_path && `key` ).
          IF ls_field-description IS INITIAL.
            ls_field-description = ls_field-camel.
          ENDIF.
          APPEND ls_field TO rt_fields.
        ENDDO.
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid PARSE DDLS answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD metadata.
    DATA lv_json TYPE string.
    DATA ls_field TYPE zcl_osd_adt_tabledata=>ty_field.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_json = `{"count":0,"ms":0,"columns":[`.
    LOOP AT it_fields INTO ls_field.
      IF sy-tabix > 1.
        lv_json = lv_json && `,`.
      ENDIF.
      lv_json = lv_json && `{"upper":` && zcl_osd_adt_json=>quote( to_upper( ls_field-name ) ) && `,"cells":[]}`.
    ENDLOOP.
    lv_json = lv_json && `]}`.
    TRY.
        ro_json = zcl_ajson=>parse( lv_json ).
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid metadata columns` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_name TYPE string.
    DATA lv_cds TYPE abap_bool.
    DATA lv_metadata TYPE abap_bool.
    DATA lv_link TYPE abap_bool.
    DATA lv_camel TYPE abap_bool.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lt_fields TYPE zcl_osd_adt_tabledata=>tt_field.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_cds = boolc( is_request-pattern CS `/cds` ).
    lv_metadata = boolc( is_request-method = `GET` OR is_request-method = `HEAD` ).
    IF lv_metadata = abap_true.
      READ TABLE is_request-params INTO ls_param WITH KEY name = `name`.
      lv_name = to_upper( ls_param-value ).
      lv_link = abap_true.
    ELSEIF lv_cds = abap_true.
      lv_name = to_upper( zcl_osd_adt_freestyle=>query( is_request = is_request iv_name = `ddlSourceName` ) ).
      lv_camel = abap_true.
    ELSE.
      lv_name = to_upper( zcl_osd_adt_freestyle=>query( is_request = is_request iv_name = `ddicEntityName` ) ).
    ENDIF.
    IF lv_cds = abap_true.
      lt_fields = cds_fields( lv_name ).
    ELSE.
      TRY.
          lt_fields = table_fields( lv_name ).
        CATCH zcx_osd_adt INTO lx_error.
          IF lv_metadata = abap_true.
            IF lx_error->status = 404.
              lx_error = zcx_osd_adt=>not_found( |TABL { ls_param-value } does not exist| ).
            ENDIF.
            RAISE EXCEPTION lx_error.
          ENDIF.
          TRY.
              lt_fields = cds_fields( lv_name ).
            CATCH zcx_osd_adt INTO lx_error.
              IF lx_error->status = 501.
                RAISE EXCEPTION lx_error.
              ENDIF.
              lx_error = zcx_osd_adt=>not_found( |TABL or DDLS { lv_name } does not exist| ).
              RAISE EXCEPTION lx_error.
          ENDTRY.
      ENDTRY.
    ENDIF.
    IF lv_metadata = abap_true.
      lo_json = metadata( lt_fields ).
    ELSE.
      lo_json = zcl_osd_adt_freestyle=>sql( iv_statement = cl_abap_codepage=>convert_from( is_request-body )
        iv_limit = zcl_osd_adt_freestyle=>query( is_request = is_request iv_name = `rowNumber` iv_default = `100` )
        iv_trim = abap_true iv_fallback = `SELECT * FROM ` && lv_name ).
      zcl_osd_adt_freestyle=>refuse( lo_json ).
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8`.
    rs_response-body = zcl_osd_adt_tabledata=>document( io_json = lo_json it_fields = lt_fields iv_name = lv_name
      iv_has_name = abap_true iv_cds = lv_cds iv_camel = lv_camel iv_max_link = lv_link ).
  ENDMETHOD.
ENDCLASS.
