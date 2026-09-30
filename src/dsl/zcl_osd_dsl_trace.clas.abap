CLASS zcl_osd_dsl_trace DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS node_of
      IMPORTING io_model TYPE REF TO zif_ajson iv_path TYPE string
      RETURNING VALUE(rv_node) TYPE string.
    CLASS-METHODS sidecar
      IMPORTING iv_generator TYPE string iv_template TYPE string
                io_model TYPE REF TO zif_ajson
                is_result TYPE zcl_osd_tpl=>ty_result
      RETURNING VALUE(rv_json) TYPE string
      RAISING cx_abap_message_digest zcx_ajson_error.
ENDCLASS.

CLASS zcl_osd_dsl_trace IMPLEMENTATION.
  METHOD node_of.
    DATA lv_path TYPE string.
    DATA lv_pos TYPE i.
    lv_path = iv_path.
    DO.
      IF lv_path IS INITIAL OR lv_path = `/`.
        rv_node = io_model->get( `/@id` ).
        RETURN.
      ENDIF.
      rv_node = io_model->get( lv_path && `/@id` ).
      IF rv_node IS NOT INITIAL.
        RETURN.
      ENDIF.
      FIND REGEX `/[^/]+$` IN lv_path MATCH OFFSET lv_pos.
      IF sy-subrc <> 0.
        lv_path = `/`.
      ELSE.
        lv_path = substring( val = lv_path len = lv_pos ).
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD sidecar.
    DATA lo_json TYPE REF TO zif_ajson.
    DATA lv_hash TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lv_path TYPE string.
    DATA lv_index TYPE i.
    " open-abap-core computes the digest with the host's crypto module; the
    " browser preview maps it to crypto-browserify (webpack.config.cjs)
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = io_model->stringify( )
      IMPORTING ef_hashstring = lv_hash ).
    lo_json = zcl_ajson=>create_empty( ).
    lo_json->set_string( iv_path = `/generator` iv_val = iv_generator ).
    lo_json->set_string( iv_path = `/template` iv_val = iv_template ).
    lo_json->set_string( iv_path = `/model` iv_val = `sha256:` && to_lower( lv_hash ) ).
    lo_json->touch_array( `/lines` ).
    LOOP AT is_result-trace INTO ls_trace.
      lv_index = sy-tabix.
      lv_path = `/lines/` && lv_index.
      lo_json->set_integer( iv_path = lv_path && `/line` iv_val = ls_trace-line ).
      lo_json->set_integer( iv_path = lv_path && `/template_line` iv_val = ls_trace-template_line ).
      lo_json->set_string( iv_path = lv_path && `/path` iv_val = ls_trace-path ).
      lo_json->set_string( iv_path = lv_path && `/node`
                           iv_val = node_of( io_model = io_model iv_path = ls_trace-path ) ).
    ENDLOOP.
    rv_json = lo_json->stringify( ).
  ENDMETHOD.
ENDCLASS.
