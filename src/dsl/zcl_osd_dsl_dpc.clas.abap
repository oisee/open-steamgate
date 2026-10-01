CLASS zcl_osd_dsl_dpc DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS project_model
      IMPORTING is_model TYPE zcl_stg_segw_gen=>ty_model
      RETURNING VALUE(ri_model) TYPE REF TO zif_ajson
      RAISING cx_static_check.
    CLASS-METHODS project_model_json
      IMPORTING is_model TYPE zcl_stg_segw_gen=>ty_model
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS render_model
      IMPORTING io_model TYPE REF TO zif_ajson
      RETURNING VALUE(rs_result) TYPE zcl_osd_tpl=>ty_result
      RAISING cx_static_check.
    CLASS-METHODS render_class
      IMPORTING is_model TYPE zcl_stg_segw_gen=>ty_model
      RETURNING VALUE(rs_result) TYPE zcl_osd_tpl=>ty_result
      RAISING cx_static_check.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_op,
             kind TYPE string,
             method TYPE string,
             set_name TYPE string,
             type_stem TYPE string,
             sort_key TYPE string,
             op TYPE zcl_stg_segw_gen=>ty_operation,
             entity TYPE zcl_stg_segw_gen=>ty_entity_type,
             entity_set TYPE zcl_stg_segw_gen=>ty_entity_set,
           END OF ty_op.
    TYPES tt_op TYPE STANDARD TABLE OF ty_op WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_impl,
             name TYPE string,
             flag TYPE string,
             kind TYPE string,
             operation TYPE ty_op,
             opaque TYPE string,
           END OF ty_impl.
    TYPES tt_impl TYPE STANDARD TABLE OF ty_impl WITH DEFAULT KEY.
    CLASS-METHODS quoted IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS operation_json
      IMPORTING is_op TYPE ty_op iv_mpc TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS sadl_json
      IMPORTING is_model TYPE zcl_stg_segw_gen=>ty_model
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_osd_dsl_dpc IMPLEMENTATION.
  METHOD quoted.
    rv_text = `"` && zcl_stg_json=>escape( iv_text ) && `"`.
  ENDMETHOD.

  METHOD operation_json.
    DATA lv_id TYPE string.
    DATA lv_tab TYPE string.
    lv_tab = cl_abap_char_utilities=>horizontal_tab.
    lv_id = `entity/` && is_op-entity-name && `/set/` && is_op-set_name
      && `/operation/` && is_op-method.
    rv_json = `{"@id":` && quoted( lv_id )
      && `,"method":` && quoted( is_op-method )
      && `,"method_lower":` && quoted( to_lower( is_op-method ) )
      && `,"type_stem":` && quoted( is_op-type_stem )
      && `,"type_stem_lower":` && quoted( to_lower( is_op-type_stem ) )
      && `,"mpc":` && quoted( iv_mpc )
      && `,"mpc_lower":` && quoted( to_lower( iv_mpc ) )
      && `,"tab":` && quoted( lv_tab )
      && `,"set_name":` && quoted( is_op-set_name )
      && `,"function_name":` && quoted( is_op-op-function_name )
      && `,"remote_service":` && quoted( is_op-entity_set-sadl_service )
      && `,"remote_set":` && quoted( is_op-entity_set-sadl_set ) && `}`.
  ENDMETHOD.

  METHOD sadl_json.
    DATA ls_type TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_prop TYPE zcl_stg_segw_gen=>ty_property.
    DATA lt_sets TYPE zcl_stg_segw_gen=>tt_entity_set.
    DATA lt_types TYPE zcl_stg_segw_gen=>tt_entity_type.
    DATA lv_refs TYPE string.
    DATA lv_sources TYPE string.
    DATA lv_structures TYPE string.
    DATA lv_properties TYPE string.
    DATA lv_index TYPE i.
    DATA lv_n TYPE i.
    DATA lv_edit TYPE string.
    DATA lv_key TYPE string.
    LOOP AT is_model-entity_types INTO ls_type.
      LOOP AT ls_type-entity_sets INTO ls_set.
        IF ls_set-sadl_type IS INITIAL OR ls_set-sadl_type = 'ODC'.
          CONTINUE.
        ENDIF.
        APPEND ls_set TO lt_sets.
        APPEND ls_type TO lt_types.
        lv_index = lv_index + 1.
        IF ls_set-sadl_type <> 'EPM'.
          IF lv_refs IS NOT INITIAL.
            lv_refs = lv_refs && `,`.
          ENDIF.
          lv_refs = lv_refs && `{"@id":`
            && quoted( `entity/` && ls_type-name && `/set/` && ls_set-name )
            && `,"binding":` && quoted( ls_set-sadl_binding )
            && `,"binding_lower":` && quoted( to_lower( ls_set-sadl_binding ) )
            && `,"index":` && quoted( |{ lv_index }| ) && `}`.
        ENDIF.
        IF lv_sources IS NOT INITIAL.
          lv_sources = lv_sources && `,`.
        ENDIF.
        lv_sources = lv_sources && `{"@id":`
          && quoted( `entity/` && ls_type-name && `/set/` && ls_set-name )
          && `,"name":` && quoted( ls_set-name )
          && `,"type":` && quoted( ls_set-sadl_type )
          && `,"binding":` && quoted( ls_set-sadl_binding ) && `}`.
      ENDLOOP.
    ENDLOOP.
    lv_n = lines( lt_sets ).
    WHILE lv_n > 0.
      READ TABLE lt_sets INDEX lv_n INTO ls_set.
      READ TABLE lt_types INDEX lv_n INTO ls_type.
      IF lv_structures IS NOT INITIAL.
        lv_structures = lv_structures && `,`.
      ENDIF.
      lv_edit = 'RO'.
      IF ls_set-creatable = abap_true OR ls_set-updatable = abap_true OR ls_set-deletable = abap_true.
        lv_edit = 'EX'.
      ENDIF.
      CLEAR lv_properties.
      LOOP AT ls_type-properties INTO ls_prop.
        IF lv_properties IS NOT INITIAL.
          lv_properties = lv_properties && `,`.
        ENDIF.
        lv_key = 'FALSE'.
        IF ls_prop-is_key = abap_true.
          lv_key = 'TRUE'.
        ENDIF.
        lv_properties = lv_properties && `{"@id":`
          && quoted( `entity/` && ls_type-name && `/property/` && ls_prop-name )
          && `,"abap_field":` && quoted( ls_prop-abap_field )
          && `,"key":` && quoted( lv_key ) && `}`.
      ENDLOOP.
      lv_structures = lv_structures && `{"@id":`
        && quoted( `entity/` && ls_type-name && `/set/` && ls_set-name )
        && `,"name":` && quoted( ls_set-name )
        && `,"edit_mode":` && quoted( lv_edit )
        && `,"properties":[` && lv_properties && `]}`.
      lv_n = lv_n - 1.
    ENDWHILE.
    rv_json = `,"refs":[` && lv_refs && `],"sadl_sources":[`
      && lv_sources && `],"sadl_structures":[` && lv_structures && `]`.
  ENDMETHOD.

  METHOD project_model_json.
    DATA lt_ops TYPE tt_op.
    DATA lt_sorted TYPE tt_op.
    DATA lt_impls TYPE tt_impl.
    DATA lt_kinds TYPE string_table.
    DATA lt_redefs TYPE string_table.
    DATA ls_type TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_operation TYPE zcl_stg_segw_gen=>ty_operation.
    DATA ls_op TYPE ty_op.
    DATA ls_impl TYPE ty_impl.
    DATA lv_sadl TYPE abap_bool.
    DATA lv_shlp TYPE abap_bool.
    DATA lv_kind TYPE string.
    DATA lv_name TYPE string.
    DATA lv_flag TYPE string.
    DATA lv_redefs TYPE string.
    DATA lv_declarations TYPE string.
    DATA lv_impls TYPE string.
    DATA lv_cases TYPE string.
    DATA lv_op_json TYPE string.
    DATA lv_first TYPE abap_bool.
    DATA lv_opaque TYPE string.
    DATA lv_missing TYPE string.
    DATA lv_node TYPE string.
    DATA lv_separator TYPE string.
    LOOP AT is_model-entity_types INTO ls_type.
      LOOP AT ls_type-entity_sets INTO ls_set.
        LOOP AT ls_set-operations INTO ls_operation.
          CLEAR ls_op.
          ls_op-kind = ls_operation-type.
          ls_op-method = ls_operation-method.
          ls_op-set_name = ls_set-name.
          ls_op-type_stem = ls_type-type_stem.
          ls_op-sort_key = replace( val = ls_operation-method sub = '_' with = '/' occ = 0 ).
          ls_op-op = ls_operation.
          ls_op-entity = ls_type.
          ls_op-entity_set = ls_set.
          APPEND ls_op TO lt_ops.
          READ TABLE lt_kinds WITH KEY table_line = ls_op-kind TRANSPORTING NO FIELDS.
          IF sy-subrc <> 0.
            APPEND ls_op-kind TO lt_kinds.
          ENDIF.
          IF ls_set-sadl_type IS NOT INITIAL AND ls_set-sadl_type <> 'ODC'.
            lv_sadl = abap_true.
          ENDIF.
          IF ls_operation-mapping_kind = 'SHLP'.
            lv_shlp = abap_true.
          ENDIF.
        ENDLOOP.
      ENDLOOP.
    ENDLOOP.
    lt_sorted = lt_ops.
    SORT lt_sorted BY sort_key.
    DO 5 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'Q'.
          lv_name = 'GET_ENTITYSET'.
        WHEN 2.
          lv_kind = 'R'.
          lv_name = 'GET_ENTITY'.
        WHEN 3.
          lv_kind = 'U'.
          lv_name = 'UPDATE_ENTITY'.
        WHEN 4.
          lv_kind = 'C'.
          lv_name = 'CREATE_ENTITY'.
        WHEN 5.
          lv_kind = 'D'.
          lv_name = 'DELETE_ENTITY'.
      ENDCASE.
      READ TABLE lt_kinds WITH KEY table_line = lv_kind TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        APPEND lv_name TO lt_redefs.
      ENDIF.
    ENDDO.
    IF lv_sadl = abap_true.
      APPEND 'CREATE_DEEP_ENTITY' TO lt_redefs.
      APPEND 'EXECUTE_ACTION' TO lt_redefs.
      APPEND 'GET_IS_CONDITIONAL_IMPLEMENTED' TO lt_redefs.
      APPEND 'GET_IS_CONDI_IMPLE_FOR_ACTION' TO lt_redefs.
      APPEND 'PATCH_ENTITY' TO lt_redefs.
    ENDIF.
    LOOP AT lt_redefs INTO lv_name.
      IF lv_redefs IS NOT INITIAL.
        lv_redefs = lv_redefs && `,`.
      ENDIF.
      lv_redefs = lv_redefs && `{"@id":` && quoted( `method/` && lv_name )
        && `,"name":` && quoted( lv_name ) && `}`.
    ENDLOOP.
    LOOP AT lt_sorted INTO ls_op.
      IF lv_declarations IS NOT INITIAL.
        lv_declarations = lv_declarations && `,`.
      ENDIF.
      lv_op_json = operation_json( is_op = ls_op iv_mpc = is_model-mpc ).
      lv_flag = `is_` && to_lower( ls_op-kind ).
      lv_declarations = lv_declarations
        && substring( val = lv_op_json len = strlen( lv_op_json ) - 1 )
        && `,"` && lv_flag && `":"X"}`.
    ENDLOOP.
    DO 5 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'C'.
          lv_name = 'CREATE_ENTITY'.
        WHEN 2.
          lv_kind = 'D'.
          lv_name = 'DELETE_ENTITY'.
        WHEN 3.
          lv_kind = 'R'.
          lv_name = 'GET_ENTITY'.
        WHEN 4.
          lv_kind = 'Q'.
          lv_name = 'GET_ENTITYSET'.
        WHEN 5.
          lv_kind = 'U'.
          lv_name = 'UPDATE_ENTITY'.
      ENDCASE.
      READ TABLE lt_kinds WITH KEY table_line = lv_kind TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        CLEAR ls_impl.
        ls_impl-name = `/IWBEP/IF_MGW_APPL_SRV_RUNTIME~` && lv_name.
        ls_impl-kind = lv_kind.
        ls_impl-flag = `dispatch_` && to_lower( lv_kind ).
        APPEND ls_impl TO lt_impls.
      ENDIF.
    ENDDO.
    CLEAR ls_impl.
    ls_impl-name = 'CHECK_SUBSCRIPTION_AUTHORITY'.
    ls_impl-flag = 'fixed_check_subscription_authority'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~COMMIT_WORK'.
    ls_impl-flag = 'fixed_commit_work'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~GET_GENERATION_STRATEGY'.
    ls_impl-flag = 'fixed_get_generation_strategy'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~LOG_MESSAGE'.
    ls_impl-flag = 'fixed_log_message'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_EXCEPTION_HANDLING'.
    ls_impl-flag = 'fixed_rfc_exception_handling'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_SAVE_LOG'.
    ls_impl-flag = 'fixed_rfc_save_log'.
    APPEND ls_impl TO lt_impls.
    ls_impl-name = '/IWBEP/IF_SB_DPC_COMM_SERVICES~SET_INJECTION'.
    ls_impl-flag = 'fixed_set_injection'.
    APPEND ls_impl TO lt_impls.
    IF lv_sadl = abap_true.
      ls_impl-name = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_DEEP_ENTITY'.
      ls_impl-flag = 'sadl_create_deep_entity'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~EXECUTE_ACTION'.
      ls_impl-flag = 'sadl_execute_action'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDITIONAL_IMPLEMENTED'.
      ls_impl-flag = 'sadl_get_is_conditional_implemented'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDI_IMPLE_FOR_ACTION'.
      ls_impl-flag = 'sadl_get_is_condi_imple_for_action'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~PATCH_ENTITY'.
      ls_impl-flag = 'sadl_patch_entity'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = 'IF_SADL_GW_DPC_UTIL~GET_DPC'.
      ls_impl-flag = 'sadl_get_dpc'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = 'IF_SADL_GW_EXTENSION_CONTROL~SET_EXTENSION_MAPPING'.
      ls_impl-flag = 'sadl_set_extension_mapping'.
      APPEND ls_impl TO lt_impls.
      ls_impl-name = 'IF_SADL_GW_QUERY_CONTROL~SET_QUERY_OPTIONS'.
      ls_impl-flag = 'sadl_set_query_options'.
      APPEND ls_impl TO lt_impls.
    ENDIF.
    IF lv_shlp = abap_true.
      ls_impl-name = zcl_stg_segw_gen_rfc=>gc_shlp_interface && '~GET_SEARCH_HELP_VALUES'.
      ls_impl-flag = 'opaque'.
      ls_impl-opaque = zcl_stg_segw_gen_rfc=>shlp_implementation( ).
      APPEND ls_impl TO lt_impls.
    ENDIF.
    LOOP AT lt_sorted INTO ls_op.
      CLEAR ls_impl.
      ls_impl-name = ls_op-method.
      ls_impl-operation = ls_op.
      IF ls_op-op-mapping_kind = 'RFC'.
        lv_opaque = zcl_stg_segw_gen_rfc=>rfc_method(
          is_op = ls_op-op is_type = ls_op-entity is_model = is_model
          it_signature = zcl_stg_segw_fugr=>signature( ls_op-op-function_name ) ).
        IF lv_opaque IS INITIAL.
          ls_impl-flag = 'stub'.
        ELSE.
          ls_impl-flag = 'opaque'.
          ls_impl-opaque = lv_opaque.
        ENDIF.
      ELSEIF ls_op-op-mapping_kind = 'SHLP'.
        lv_opaque = zcl_stg_segw_gen_rfc=>shlp_method( is_op = ls_op-op is_type = ls_op-entity ).
        IF lv_opaque IS INITIAL.
          ls_impl-flag = 'stub'.
        ELSE.
          ls_impl-flag = 'opaque'.
          ls_impl-opaque = lv_opaque.
        ENDIF.
      ELSEIF ls_op-entity_set-sadl_type = 'ODC'.
        IF ls_op-kind = 'Q' OR ls_op-kind = 'R'.
          ls_impl-flag = `odc_` && to_lower( ls_op-kind ).
        ELSE.
          ls_impl-flag = 'stub'.
        ENDIF.
      ELSEIF ls_op-entity_set-sadl_type IS NOT INITIAL.
        ls_impl-flag = `delegate_` && to_lower( ls_op-kind ).
      ELSE.
        ls_impl-flag = 'stub'.
      ENDIF.
      APPEND ls_impl TO lt_impls.
    ENDLOOP.
    SORT lt_impls BY name.
    lv_first = abap_true.
    LOOP AT lt_impls INTO ls_impl.
      IF lv_impls IS NOT INITIAL.
        lv_impls = lv_impls && `,`.
      ENDIF.
      lv_node = `method/` && ls_impl-name.
      IF ls_impl-operation-method IS NOT INITIAL.
        lv_node = `entity/` && ls_impl-operation-entity-name && `/set/`
          && ls_impl-operation-set_name && `/operation/` && ls_impl-operation-method.
      ENDIF.
      lv_separator = cl_abap_char_utilities=>newline.
      IF lv_first = abap_false.
        lv_separator = lv_separator && cl_abap_char_utilities=>newline.
      ENDIF.
      lv_impls = lv_impls && `{"@id":` && quoted( lv_node )
        && `,"name":` && quoted( ls_impl-name )
        && `,"separator":` && quoted( lv_separator )
        && `,"` && ls_impl-flag && `":"X"`.
      lv_first = abap_false.
      IF ls_impl-kind IS NOT INITIAL.
        CLEAR lv_cases.
        LOOP AT lt_ops INTO ls_op WHERE kind = ls_impl-kind.
          IF lv_cases IS NOT INITIAL.
            lv_cases = lv_cases && `,`.
          ENDIF.
          lv_cases = lv_cases && operation_json( is_op = ls_op iv_mpc = is_model-mpc ).
        ENDLOOP.
        lv_impls = lv_impls && `,"cases":[` && lv_cases && `]`.
      ELSEIF ls_impl-operation-method IS NOT INITIAL.
        lv_op_json = operation_json( is_op = ls_impl-operation iv_mpc = is_model-mpc ).
        CLEAR lv_missing.
        IF ls_impl-operation-op-mapping_kind = 'RFC' AND ls_impl-flag = 'stub'.
          lv_missing = 'X'.
        ENDIF.
        lv_impls = lv_impls && `,"operation":` && lv_op_json
          && `,"method":` && quoted( ls_impl-operation-method )
          && `,"remote_service":` && quoted( ls_impl-operation-entity_set-sadl_service )
          && `,"remote_set":` && quoted( ls_impl-operation-entity_set-sadl_set )
          && `,"service":` && quoted( is_model-service )
          && `,"function_name":` && quoted( ls_impl-operation-op-function_name )
          && `,"missing_rfc":` && quoted( lv_missing ).
      ENDIF.
      IF ls_impl-opaque IS NOT INITIAL.
        lv_impls = lv_impls && `,"opaque":` && quoted( ls_impl-opaque ).
      ENDIF.
      lv_impls = lv_impls && `}`.
    ENDLOOP.
    rv_json = `{"@id":` && quoted( `project/` && is_model-project )
      && `,"project":` && quoted( is_model-project )
      && `,"service":` && quoted( is_model-service )
      && `,"dpc":` && quoted( is_model-dpc )
      && `,"dpc_ext":` && quoted( is_model-dpc_ext )
      && `,"mpc":` && quoted( is_model-mpc )
      && `,"generated_on":` && quoted( is_model-generated_on )
      && `,"generated_at":` && quoted( is_model-generated_at )
      && `,"client":` && quoted( is_model-client )
      && `,"has_sadl":` && quoted( |{ lv_sadl }| )
      && `,"has_shlp":` && quoted( |{ lv_shlp }| )
      && `,"redefs":[` && lv_redefs && `]`
      && `,"declarations":[` && lv_declarations && `]`
      && `,"impls":[` && lv_impls && `]`
      && sadl_json( is_model ) && `}`.
  ENDMETHOD.

  METHOD project_model.
    ri_model = zcl_ajson=>parse( project_model_json( is_model ) ).
  ENDMETHOD.

  METHOD render_model.
    DATA lt_names TYPE string_table.
    DATA lv_name TYPE string.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    DATA ls_partial TYPE zcl_osd_tpl=>ty_partial.
    lt_names = zcl_osd_dsl_dpc_templates=>names( ).
    LOOP AT lt_names INTO lv_name.
      ls_partial-name = lv_name.
      ls_partial-template = zcl_osd_dsl_dpc_templates=>get( lv_name ).
      APPEND ls_partial TO lt_partials.
    ENDLOOP.
    rs_result = zcl_osd_tpl=>render( iv_template = zcl_osd_dsl_dpc_templates=>get( 'class' )
      ii_data = io_model it_partials = lt_partials iv_name = 'dpc_class' ).
  ENDMETHOD.

  METHOD render_class.
    rs_result = render_model( project_model( is_model ) ).
  ENDMETHOD.
ENDCLASS.
