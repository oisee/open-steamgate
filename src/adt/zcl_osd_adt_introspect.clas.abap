"! A8a: host introspection bodies, transported without JSON re-encoding.
CLASS zcl_osd_adt_introspect DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.
CLASS zcl_osd_adt_introspect IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lv_kind TYPE string.
    DATA lv_prefix TYPE string.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    DATA lv_status TYPE i.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    lv_prefix = zcl_osd_adt_router=>c_base && `/core/http/`.
    lv_kind = substring( val = is_request-pattern off = strlen( lv_prefix ) ).
    lv_kind = to_upper( lv_kind ).
    zcl_osd_adt_host=>require( `SYSTEM` ).
    CREATE OBJECT lo_input.
    lo_input->add( iv_name = `kind` iv_value = lv_kind ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `SYSTEM` iv_type = lv_kind iv_json = lo_input->document( ) ).
    IF ls_answer-json IS NOT INITIAL.
      TRY.
          lo_json = zcl_ajson=>parse( iv_json = ls_answer-json iv_keep_item_order = abap_true ).
          lv_status = lo_json->get_integer( `/refuse/status` ).
          CREATE OBJECT lx_error EXPORTING iv_status = lv_status
            iv_type = lo_json->get_string( `/refuse/type` )
            iv_message = lo_json->get_string( `/refuse/message` ).
          RAISE EXCEPTION lx_error.
        CATCH zcx_ajson_error INTO lx_json.
          lx_error = zcx_osd_adt=>internal( lx_json->get_text( ) ).
          RAISE EXCEPTION lx_error.
      ENDTRY.
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `application/json; charset=utf-8`.
    rs_response-body = ls_answer-source.
  ENDMETHOD.
ENDCLASS.
