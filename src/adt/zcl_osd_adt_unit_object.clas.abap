"! C2a: ABAP Unit metadata and the ordered discovery JSON projection.
CLASS zcl_osd_adt_unit_object DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS metadata RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS document IMPORTING io_plan TYPE REF TO zcl_ajson
      RETURNING VALUE(rv_json) TYPE string RAISING zcx_ajson_error.
  PRIVATE SECTION.
    CLASS-METHODS value IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string
      RETURNING VALUE(rv_json) TYPE string RAISING zcx_ajson_error.
    CLASS-METHODS project IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string iv_keys TYPE string
      RETURNING VALUE(rv_json) TYPE string RAISING zcx_ajson_error.
ENDCLASS.
CLASS zcl_osd_adt_unit_object IMPLEMENTATION.
  METHOD metadata.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?><aunit:metadata xmlns:aunit="http://www.sap.com/adt/aunit">`
      && `<aunit:supportedTypeFeatures globalWorkbenchType="DEVC/K" ownTests="true" assignedTests="true" coverage="false"/>`
      && `<aunit:supportedTypeFeatures globalWorkbenchType="CLAS/OC" ownTests="true" assignedTests="true" coverage="false"/>`
      && `<aunit:supportedTypeFeatures globalWorkbenchType="PROG/P" ownTests="true" assignedTests="true" coverage="false"/>`
      && `</aunit:metadata>`.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_type TYPE string.
    DATA lv_tail TYPE string.
    DATA lv_name TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_plan TYPE REF TO zcl_ajson.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    IF is_request-pattern = `/sap/bc/adt/abapunit/metadata`.
      rs_response-status = 200.
      rs_response-content_type = `application/vnd.sap.adt.abapunit.metadata.result.v1+xml; charset=utf-8`.
      rs_response-body = metadata( ).
      RETURN.
    ENDIF.
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `type`
      IMPORTING ev_value = lv_type ev_found = lv_found ).
    SPLIT lv_type AT `/` INTO lv_type lv_tail.
    lv_type = to_upper( lv_type ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `name`
      IMPORTING ev_value = lv_name ev_found = lv_found ).
    lv_name = to_upper( lv_name ).
    IF lv_type <> `CLAS` AND lv_type <> `PROG`.
      IF lv_type IS INITIAL.
        lv_type = `object`.
      ENDIF.
      lx_error = zcx_osd_adt=>invalid_request( lv_type && ` cannot carry ABAP Unit tests here` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    zcl_osd_adt_host=>require( `PARSE` ).
    TRY.
        CREATE OBJECT lo_input.
        lo_input->add( iv_name = `kind` iv_value = `UNIT_PLAN` ).
        lo_input->add( iv_name = `type` iv_value = lv_type ).
        lo_input->add( iv_name = `name` iv_value = lv_name ).
        lo_input->add_raw( iv_name = `risk` iv_json = `true` ).
        ls_answer = zcl_osd_adt_host=>store( iv_command = `PARSE` iv_json = lo_input->document( ) ).
        lo_plan = zcl_ajson=>parse( iv_json = ls_answer-json iv_keep_item_order = abap_true ).
        rs_response-body = document( lo_plan ).
      CATCH zcx_osd_adt INTO lx_error.
        IF lx_error->status = 404 OR lx_error->status = 501.
          RAISE EXCEPTION lx_error.
        ENDIF.
        CREATE OBJECT lx_error EXPORTING iv_status = 500 iv_type = `ExceptionTestDiscoveryFailed`
          iv_message = lx_error->message_text.
        RAISE EXCEPTION lx_error.
      CATCH zcx_ajson_error INTO lx_json.
        CREATE OBJECT lx_error EXPORTING iv_status = 500 iv_type = `ExceptionTestDiscoveryFailed`
          iv_message = lx_json->get_text( ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    rs_response-status = 200.
    rs_response-content_type = `application/json; charset=utf-8`.
  ENDMETHOD.
  METHOD value.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_child TYPE string.
    DATA lv_type TYPE string.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    lv_type = io_json->zif_ajson~get_node_type( iv_path ).
    CASE lv_type.
      WHEN `str`.
        rv_json = zcl_osd_adt_json=>quote( io_json->get_string( iv_path ) ).
      WHEN `bool` OR `num`.
        rv_json = io_json->get( iv_path ).
      WHEN `array`.
        rv_json = `[`.
        lt_members = zcl_osd_adt_json=>ordered_members( io_json = io_json iv_path = iv_path ).
        LOOP AT lt_members INTO lv_member.
          IF sy-tabix > 1.
            rv_json = rv_json && `,`.
          ENDIF.
          lv_child = value( io_json = io_json iv_path = iv_path && `/` && lv_member ).
          rv_json = rv_json && lv_child.
        ENDLOOP.
        rv_json = rv_json && `]`.
      WHEN `object`.
        CREATE OBJECT lo_writer.
        lt_members = zcl_osd_adt_json=>ordered_members( io_json = io_json iv_path = iv_path ).
        LOOP AT lt_members INTO lv_member.
          lv_child = value( io_json = io_json iv_path = iv_path && `/` && lv_member ).
          lo_writer->add_raw( iv_name = lv_member iv_json = lv_child ).
        ENDLOOP.
        rv_json = lo_writer->document( ).
      WHEN OTHERS.
        rv_json = `null`.
    ENDCASE.
  ENDMETHOD.
  METHOD project.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    DATA lt_keys TYPE string_table.
    DATA lv_key TYPE string.
    DATA lv_path TYPE string.
    CREATE OBJECT lo_writer.
    SPLIT iv_keys AT `,` INTO TABLE lt_keys.
    LOOP AT lt_keys INTO lv_key.
      lv_path = iv_path && `/` && lv_key.
      IF io_json->exists( lv_path ) = abap_true.
        lo_writer->add_raw( iv_name = lv_key iv_json = value( io_json = io_json iv_path = lv_path ) ).
      ENDIF.
    ENDLOOP.
    rv_json = lo_writer->document( ).
  ENDMETHOD.
  METHOD document.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    DATA lo_class TYPE REF TO zcl_osd_adt_json.
    DATA lt_classes TYPE string_table.
    DATA lv_class TYPE string.
    DATA lt_methods TYPE string_table.
    DATA lv_method TYPE string.
    DATA lv_path TYPE string.
    DATA lv_methods TYPE string.
    DATA lv_classes TYPE string.
    DATA lv_key TYPE string.
    DATA lt_keys TYPE string_table.
    CREATE OBJECT lo_writer.
    lo_writer->add_raw( iv_name = `object` iv_json = project( io_json = io_plan iv_path = `/object` iv_keys = `type,name` ) ).
    SPLIT `writes,writesTotal,riskError` AT `,` INTO TABLE lt_keys.
    LOOP AT lt_keys INTO lv_key.
      IF io_plan->exists( `/` && lv_key ) = abap_true.
        lo_writer->add_raw( iv_name = lv_key iv_json = value( io_json = io_plan iv_path = `/` && lv_key ) ).
      ENDIF.
    ENDLOOP.
    lv_classes = `[`.
    lt_classes = zcl_osd_adt_json=>ordered_members( io_json = io_plan iv_path = `/classes` ).
    LOOP AT lt_classes INTO lv_class.
      IF sy-tabix > 1.
        lv_classes = lv_classes && `,`.
      ENDIF.
      lv_path = `/classes/` && lv_class.
      CREATE OBJECT lo_class.
      SPLIT `name,riskLevel,riskLevelDeclared,durationCategory,durationDeclared,schedule,include,line,column` AT `,` INTO TABLE lt_keys.
      LOOP AT lt_keys INTO lv_key.
        IF io_plan->exists( lv_path && `/` && lv_key ) = abap_true.
          lo_class->add_raw( iv_name = lv_key iv_json = value( io_json = io_plan iv_path = lv_path && `/` && lv_key ) ).
        ENDIF.
      ENDLOOP.
      lt_methods = zcl_osd_adt_json=>ordered_members( io_json = io_plan iv_path = lv_path && `/testMethods` ).
      lv_methods = `[`.
      LOOP AT lt_methods INTO lv_method.
        IF sy-tabix > 1.
          lv_methods = lv_methods && `,`.
        ENDIF.
        lv_methods = lv_methods && project( io_json = io_plan iv_path = lv_path && `/testMethods/` && lv_method iv_keys = `name,line,column` ).
      ENDLOOP.
      lv_methods = lv_methods && `]`.
      lo_class->add_raw( iv_name = `methods` iv_json = lv_methods ).
      lv_classes = lv_classes && lo_class->document( ).
    ENDLOOP.
    lv_classes = lv_classes && `]`.
    lo_writer->add_raw( iv_name = `classes` iv_json = lv_classes ).
    rv_json = lo_writer->document( ).
  ENDMETHOD.
ENDCLASS.
