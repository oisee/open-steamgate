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
    DATA lv_hash TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lv_node TYPE string.
    DATA lv_first TYPE abap_bool.
    TYPES: BEGIN OF ty_cached_node,
             path TYPE string,
             node TYPE string,
           END OF ty_cached_node.
    DATA lt_nodes TYPE HASHED TABLE OF ty_cached_node WITH UNIQUE KEY path.
    DATA ls_node TYPE ty_cached_node.
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = io_model->stringify( )
      IMPORTING ef_hashstring = lv_hash ).
    rv_json = `{"generator":"` && zcl_stg_json=>escape( iv_generator ) && `","lines":[`.
    lv_first = abap_true.
    LOOP AT is_result-trace INTO ls_trace.
      READ TABLE lt_nodes INTO ls_node WITH TABLE KEY path = ls_trace-path.
      IF sy-subrc <> 0.
        ls_node-path = ls_trace-path.
        ls_node-node = node_of( io_model = io_model iv_path = ls_trace-path ).
        INSERT ls_node INTO TABLE lt_nodes.
      ENDIF.
      lv_node = zcl_stg_json=>escape( ls_node-node ).
      IF lv_first = abap_false.
        rv_json = rv_json && `,`.
      ENDIF.
      lv_first = abap_false.
      rv_json = rv_json && `{"line":` && |{ ls_trace-line }|
        && `,"node":"` && lv_node
        && `","path":"` && zcl_stg_json=>escape( ls_trace-path )
        && `","template_line":` && |{ ls_trace-template_line }| && `}`.
    ENDLOOP.
    rv_json = rv_json && `],"model":"sha256:` && to_lower( lv_hash )
      && `","template":"` && zcl_stg_json=>escape( iv_template ) && `"}`.
  ENDMETHOD.
ENDCLASS.
