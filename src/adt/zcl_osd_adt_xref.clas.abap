"! A9: where-used reads on the request's serving connection.
CLASS zcl_osd_adt_xref DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_object,
             name TYPE string,
             type TYPE string,
             sort_key TYPE string,
           END OF ty_object.
    TYPES tt_object TYPE STANDARD TABLE OF ty_object WITH DEFAULT KEY.
    CLASS-METHODS fact IMPORTING iv_kind TYPE string iv_json TYPE string OPTIONAL
      RETURNING VALUE(ro_json) TYPE REF TO zcl_ajson RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS edges IMPORTING iv_name TYPE string iv_readers TYPE abap_bool
      RETURNING VALUE(rt_names) TYPE string_table.
    CLASS-METHODS walk IMPORTING iv_name TYPE string iv_limit TYPE i
      EXPORTING et_names TYPE string_table ev_truncated TYPE abap_bool.
    CLASS-METHODS objects IMPORTING it_names TYPE string_table iv_name TYPE string iv_type TYPE string
      RETURNING VALUE(rt_objects) TYPE tt_object RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS readers IMPORTING it_objects TYPE tt_object io_tests TYPE REF TO zcl_ajson iv_type TYPE string iv_name TYPE string iv_source TYPE string
      RETURNING VALUE(rv_json) TYPE string RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS closure IMPORTING it_objects TYPE tt_object io_tests TYPE REF TO zcl_ajson iv_type TYPE string iv_name TYPE string iv_source TYPE string iv_truncated TYPE abap_bool
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS is_test IMPORTING io_tests TYPE REF TO zcl_ajson iv_name TYPE string
      RETURNING VALUE(rv_test) TYPE abap_bool.
    CLASS-METHODS array_add IMPORTING iv_item TYPE string CHANGING cv_array TYPE string.
    CLASS-METHODS boolean IMPORTING iv_value TYPE abap_bool RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_xref IMPLEMENTATION.
  METHOD fact.
    ro_json = zcl_ajson=>parse( iv_json = zcl_osd_adt_host=>system( iv_kind = iv_kind iv_json = iv_json )
      iv_keep_item_order = abap_true ).
  ENDMETHOD.
  METHOD edges.
    DATA lt_rows TYPE STANDARD TABLE OF wbcrossgt-include WITH DEFAULT KEY.
    DATA lt_extra LIKE lt_rows.
    DATA lv_row LIKE LINE OF lt_rows.
    DATA lv_text TYPE string.
    IF iv_readers = abap_true.
      SELECT DISTINCT include FROM wbcrossgt INTO TABLE lt_rows UP TO 5000 ROWS
        WHERE otype = 'TY' AND name = iv_name AND include <> iv_name ORDER BY include.
      SELECT DISTINCT include FROM wbcrossgtx INTO TABLE lt_extra UP TO 5000 ROWS
        WHERE otype = 'TY' AND name = iv_name AND include <> iv_name ORDER BY include.
    ELSE.
      SELECT DISTINCT include FROM wbcrossgt INTO TABLE lt_rows UP TO 5000 ROWS
        WHERE otype = 'TY' AND name = iv_name ORDER BY include.
      SELECT DISTINCT include FROM wbcrossgtx INTO TABLE lt_extra UP TO 5000 ROWS
        WHERE otype = 'TY' AND name = iv_name ORDER BY include.
    ENDIF.
    APPEND LINES OF lt_extra TO lt_rows.
*   Node caps the SQL UNION in binary include order, before uppercasing.
*   Each ordered distinct prefix contains every candidate for that cap.
    SORT lt_rows.
    DELETE ADJACENT DUPLICATES FROM lt_rows.
    LOOP AT lt_rows INTO lv_row.
      IF iv_readers = abap_true AND lv_row = iv_name.
        CONTINUE.
      ENDIF.
      lv_text = lv_row.
      APPEND to_upper( lv_text ) TO rt_names.
      IF lines( rt_names ) = 5000.
        EXIT.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD walk.
    DATA lt_seen TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lt_todo TYPE string_table.
    DATA lt_edges TYPE string_table.
    DATA lv_name TYPE string.
    DATA lv_edge TYPE string.
    DATA lv_last TYPE i.
    INSERT iv_name INTO TABLE lt_seen.
    APPEND iv_name TO et_names.
    APPEND iv_name TO lt_todo.
    WHILE lines( lt_todo ) > 0 AND lines( et_names ) < iv_limit.
      lv_last = lines( lt_todo ).
      READ TABLE lt_todo INDEX lv_last INTO lv_name.
      DELETE lt_todo INDEX lv_last.
      lt_edges = edges( iv_name = lv_name iv_readers = abap_false ).
      LOOP AT lt_edges INTO lv_edge.
        INSERT lv_edge INTO TABLE lt_seen.
        IF sy-subrc = 0.
          APPEND lv_edge TO et_names.
          APPEND lv_edge TO lt_todo.
        ENDIF.
      ENDLOOP.
    ENDWHILE.
    ev_truncated = boolc( lines( lt_todo ) > 0 ).
  ENDMETHOD.
  METHOD objects.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_types TYPE REF TO zcl_ajson.
    DATA lv_names TYPE string.
    DATA lv_name TYPE string.
    DATA ls_object TYPE ty_object.
    DATA ls_node TYPE zif_ajson_types=>ty_node.
    LOOP AT it_names INTO lv_name.
      array_add( EXPORTING iv_item = zcl_osd_adt_json=>quote( lv_name ) CHANGING cv_array = lv_names ).
    ENDLOOP.
    CREATE OBJECT lo_input.
    lo_input->add_raw( iv_name = `names` iv_json = `[` && lv_names && `]` ).
    lo_types = fact( iv_kind = `OBJECT_TYPES` iv_json = lo_input->document( ) ).
    LOOP AT it_names INTO lv_name.
      ls_object-name = lv_name.
      CLEAR ls_object-type.
      LOOP AT lo_types->mt_json_tree INTO ls_node WHERE path = `/` AND name = lv_name.
        ls_object-type = ls_node-value.
      ENDLOOP.
      IF lv_name = iv_name.
        ls_object-type = iv_type.
      ELSEIF ls_object-type IS INITIAL.
        ls_object-type = `UNKNOWN`.
      ENDIF.
      ls_object-sort_key = zcl_osd_adt_js=>collate( lv_name ).
      APPEND ls_object TO rt_objects.
    ENDLOOP.
  ENDMETHOD.
  METHOD boolean.
    rv_json = `false`.
    IF iv_value = abap_true.
      rv_json = `true`.
    ENDIF.
  ENDMETHOD.
  METHOD array_add.
    IF cv_array IS NOT INITIAL.
      cv_array = cv_array && `,`.
    ENDIF.
    cv_array = cv_array && iv_item.
  ENDMETHOD.
  METHOD is_test.
    DATA lt_tests TYPE string_table.
    lt_tests = io_tests->array_to_string_table( `` ).
    READ TABLE lt_tests WITH KEY table_line = iv_name TRANSPORTING NO FIELDS.
    rv_test = boolc( sy-subrc = 0 ).
  ENDMETHOD.
  METHOD closure.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    DATA lo_row TYPE REF TO zcl_osd_adt_json.
    DATA ls_object TYPE ty_object.
    DATA lv_rows TYPE string.
    DATA lv_tests TYPE string.
    DATA lv_test TYPE abap_bool.
    DATA lv_count TYPE i.
    CREATE OBJECT lo_writer.
    LOOP AT it_objects INTO ls_object.
      CREATE OBJECT lo_row.
      lo_row->add( iv_name = `type` iv_value = ls_object-type ).
      lo_row->add( iv_name = `name` iv_value = ls_object-name ).
      lv_test = boolc( ls_object-type = `CLAS` AND is_test( io_tests = io_tests iv_name = ls_object-name ) = abap_true ).
      lo_row->add_raw( iv_name = `isTest` iv_json = boolean( lv_test ) ).
      array_add( EXPORTING iv_item = lo_row->document( ) CHANGING cv_array = lv_rows ).
      IF lv_test = abap_true.
        lv_count = lv_count + 1.
        array_add( EXPORTING iv_item = zcl_osd_adt_json=>quote( ls_object-name ) CHANGING cv_array = lv_tests ).
      ENDIF.
    ENDLOOP.
    lo_writer->add( iv_name = `type` iv_value = iv_type ).
    lo_writer->add( iv_name = `name` iv_value = iv_name ).
    lo_writer->add( iv_name = `source` iv_value = iv_source ).
    lo_writer->add_raw( iv_name = `truncated` iv_json = boolean( iv_truncated ) ).
    lo_writer->add_raw( iv_name = `closure` iv_json = `[` && lv_rows && `]` ).
    lo_writer->add_raw( iv_name = `tests` iv_json = `[` && lv_tests && `]` ).
    lo_writer->add_raw( iv_name = `counts` iv_json = |\{"objects":{ lines( it_objects ) },"tests":{ lv_count }\}| ).
    rv_json = lo_writer->document( ).
  ENDMETHOD.
  METHOD readers.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    DATA lo_row TYPE REF TO zcl_osd_adt_json.
    DATA lo_regs TYPE REF TO zcl_ajson.
    DATA lo_rows TYPE REF TO zcl_ajson.
    DATA lt_regs TYPE string_table.
    DATA lt_rows TYPE string_table.
    DATA lt_ids TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA lv_external TYPE string.
    DATA lv_id TYPE string.
    DATA lv_services TYPE string.
    DATA lv_readers TYPE string.
    DATA lv_tests TYPE i.
    DATA lv_test TYPE abap_bool.
    DATA ls_object TYPE ty_object.
    lo_regs = fact( iv_kind = `SEGW_REGISTRATIONS` iv_json = `{"registered":true}` ).
    lt_regs = zcl_osd_adt_json=>ordered_members( io_json = lo_regs iv_path = `` ).
    LOOP AT it_objects INTO ls_object.
      CLEAR lv_services.
      LOOP AT lt_regs INTO lv_member.
        lv_path = `/` && lv_member.
        IF lo_regs->get_boolean( lv_path && `/registered` ) = abap_true
            AND lo_regs->get_string( lv_path && `/dpc` ) = ls_object-name.
          lv_external = lo_regs->get_string( lv_path && `/external` ).
          array_add( EXPORTING iv_item = zcl_osd_adt_json=>quote( lv_external ) CHANGING cv_array = lv_services ).
          lv_id = to_upper( `/sap/opu/odata/sap/` && lv_external ).
          APPEND lv_id TO lt_ids.
        ENDIF.
      ENDLOOP.
      CREATE OBJECT lo_row.
      lo_row->add( iv_name = `type` iv_value = ls_object-type ).
      lo_row->add( iv_name = `name` iv_value = ls_object-name ).
      lo_row->add( iv_name = `include` iv_value = ls_object-name ).
      lv_test = is_test( io_tests = io_tests iv_name = ls_object-name ).
      IF lv_test = abap_true.
        lv_tests = lv_tests + 1.
      ENDIF.
      lo_row->add_raw( iv_name = `isTest` iv_json = boolean( lv_test ) ).
      lo_row->add_raw( iv_name = `services` iv_json = `[` && lv_services && `]` ).
      array_add( EXPORTING iv_item = lo_row->document( ) CHANGING cv_array = lv_readers ).
    ENDLOOP.
    IF iv_type = `CLAS`.
      lo_rows = fact( `SERVICE_ROWS` ).
      lt_rows = zcl_osd_adt_json=>ordered_members( io_json = lo_rows iv_path = `` ).
      LOOP AT lt_rows INTO lv_member.
        lv_path = `/` && lv_member.
        IF to_upper( lo_rows->get_string( lv_path && `/handler` ) ) = iv_name
            OR to_upper( lo_rows->get_string( lv_path && `/mpc` ) ) = iv_name.
          APPEND to_upper( lo_rows->get_string( lv_path && `/path` ) ) TO lt_ids.
        ENDIF.
      ENDLOOP.
    ENDIF.
    SORT lt_ids.
    DELETE ADJACENT DUPLICATES FROM lt_ids.
    CREATE OBJECT lo_writer.
    lo_writer->add( iv_name = `name` iv_value = iv_name ).
    lo_writer->add( iv_name = `source` iv_value = iv_source ).
    lo_writer->add_raw( iv_name = `readers` iv_json = `[` && lv_readers && `]` ).
    lo_writer->add_raw( iv_name = `counts` iv_json = |\{"readers":{ lines( it_objects ) },"tests":{ lv_tests },"services":{ lines( lt_ids ) }\}| ).
    rv_json = lo_writer->document( ).
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_readers TYPE abap_bool.
    DATA lv_operation TYPE string.
    DATA lv_source TYPE string.
    DATA lv_limit TYPE i.
    DATA lv_truncated TYPE abap_bool.
    DATA ls_object TYPE zcl_osd_adt_host=>ty_object.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_warm TYPE REF TO zcl_ajson.
    DATA lo_tests TYPE REF TO zcl_ajson.
    DATA lt_names TYPE string_table.
    DATA lt_objects TYPE tt_object.
    DATA ls_warm TYPE ty_object.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    DATA lv_error TYPE string.
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `type` IMPORTING ev_value = lv_type ev_found = lv_found ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `name` IMPORTING ev_value = lv_name ev_found = lv_found ).
    lv_type = to_upper( lv_type ).
    lv_name = to_upper( lv_name ).
    lv_readers = boolc( is_request-pattern = `/sap/bc/adt/core/http/xref/readers` ).
    IF lv_type <> `CLAS` AND lv_type <> `INTF` OR lv_name IS INITIAL.
      IF lv_readers = abap_false.
        lx_error = zcx_osd_adt=>invalid_request( `type (CLAS or INTF) and name are required` ).
      ELSEIF lv_type <> `CLAS` AND lv_type <> `INTF`.
        lx_error = zcx_osd_adt=>invalid_request( `type must be CLAS or INTF` ).
      ELSE.
        lx_error = zcx_osd_adt=>invalid_request( `name is required` ).
      ENDIF.
      RAISE EXCEPTION lx_error.
    ENDIF.
    ls_object = zcl_osd_adt_host=>object( iv_type = lv_type iv_name = lv_name ).
    IF ls_object-found = abap_false.
      lx_error = zcx_osd_adt=>not_found( lv_type && ` ` && lv_name && ` does not exist` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    zcl_osd_adt_host=>require( `SYSTEM` ).
    TRY.
        lv_operation = `CLOSURE`.
        IF lv_readers = abap_true.
          lv_operation = `READERS`.
        ENDIF.
        CREATE OBJECT lo_input.
        lo_input->add( iv_name = `operation` iv_value = lv_operation ).
        lo_input->add( iv_name = `type` iv_value = lv_type ).
        lo_input->add( iv_name = `name` iv_value = lv_name ).
        lo_warm = fact( iv_kind = `XREF_WARM` iv_json = lo_input->document( ) ).
        lv_limit = lo_warm->get_integer( `/limit` ).
        lv_source = `warm`.
        IF lo_warm->get_boolean( `/available` ) = abap_true.
          lt_members = zcl_osd_adt_json=>ordered_members( io_json = lo_warm iv_path = `/objects` ).
          LOOP AT lt_members INTO lv_member.
            lv_path = `/objects/` && lv_member.
            ls_warm-name = lo_warm->get_string( lv_path && `/name` ).
            ls_warm-type = lo_warm->get_string( lv_path && `/type` ).
            ls_warm-sort_key = zcl_osd_adt_js=>collate( ls_warm-name ).
            APPEND ls_warm TO lt_objects.
          ENDLOOP.
        ELSE.
          lv_source = `xref`.
          IF lv_readers = abap_true.
            lt_names = edges( iv_name = lv_name iv_readers = abap_true ).
          ELSE.
            walk( EXPORTING iv_name = lv_name iv_limit = lv_limit IMPORTING et_names = lt_names ev_truncated = lv_truncated ).
          ENDIF.
          lt_objects = objects( it_names = lt_names iv_name = lv_name iv_type = lv_type ).
        ENDIF.
        lo_tests = fact( `TESTCLASSES` ).
        IF lv_readers = abap_true.
          IF lv_source = `warm`.
            LOOP AT lt_objects INTO ls_warm.
              APPEND ls_warm-name TO lt_names.
            ENDLOOP.
            lt_objects = objects( it_names = lt_names iv_name = lv_name iv_type = lv_type ).
          ENDIF.
          DELETE lt_objects WHERE name = lv_name.
          SORT lt_objects BY name.
          DELETE ADJACENT DUPLICATES FROM lt_objects COMPARING name.
          rs_response-body = readers( it_objects = lt_objects io_tests = lo_tests iv_type = lv_type iv_name = lv_name iv_source = lv_source ).
        ELSE.
          SORT lt_objects STABLE BY sort_key.
          rs_response-body = closure( it_objects = lt_objects io_tests = lo_tests iv_type = lv_type iv_name = lv_name iv_source = lv_source iv_truncated = lv_truncated ).
        ENDIF.
      CATCH zcx_osd_adt INTO lx_error.
        lv_error = lx_error->message_text.
        CREATE OBJECT lx_error EXPORTING iv_message = lv_error.
        RAISE EXCEPTION lx_error.
      CATCH zcx_ajson_error INTO lx_json.
        CREATE OBJECT lx_error EXPORTING iv_message = lx_json->get_text( ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    rs_response-status = 200.
    rs_response-content_type = `application/json; charset=utf-8`.
  ENDMETHOD.
ENDCLASS.
