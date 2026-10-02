CLASS zcl_osd_dsl_dpc_map DEFINITION PUBLIC FINAL CREATE PRIVATE.
* Data model for mapped methods. Repeated projections retain the source ID.
  PUBLIC SECTION.
    CLASS-METHODS model
      IMPORTING is_op TYPE zcl_stg_segw_gen=>ty_operation
                is_type TYPE zcl_stg_segw_gen=>ty_entity_type
                is_model TYPE zcl_stg_segw_gen=>ty_model
                iv_id TYPE string
      RETURNING VALUE(rv_json) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS q IMPORTING iv_value TYPE string RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS f IMPORTING iv_name TYPE string iv_value TYPE string RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS node IMPORTING iv_id TYPE string RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS add IMPORTING iv_item TYPE string CHANGING cv_array TYPE string.
    CLASS-METHODS parameter
      IMPORTING is_param TYPE zcl_osd_dsl_mapping=>ty_param iv_id TYPE string iv_intf TYPE string iv_local TYPE i DEFAULT 14 iv_remote TYPE i DEFAULT 21
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS use_node
      IMPORTING is_use TYPE zcl_osd_dsl_mapping=>ty_use iv_id TYPE string iv_target TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS path
      IMPORTING is_param TYPE zcl_osd_dsl_mapping=>ty_param iv_component TYPE string iv_line TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_path) TYPE string.
ENDCLASS.

CLASS zcl_osd_dsl_dpc_map IMPLEMENTATION.
  METHOD q.
    rv_json = `"` && zcl_stg_json=>escape( iv_value ) && `"`.
  ENDMETHOD.
  METHOD f.
    rv_json = `,` && q( iv_name ) && `:` && q( iv_value ).
  ENDMETHOD.
  METHOD node.
    rv_json = `{"@id":` && q( iv_id ).
  ENDMETHOD.
  METHOD add.
    IF cv_array IS NOT INITIAL.
      cv_array = cv_array && `,`.
    ENDIF.
    cv_array = cv_array && iv_item.
  ENDMETHOD.
  METHOD path.
    rv_path = to_lower( is_param-name ).
    IF iv_component IS NOT INITIAL.
      IF iv_line = abap_true.
        rv_path = `ls_` && rv_path.
      ENDIF.
      rv_path = rv_path && `-` && to_lower( iv_component ).
    ENDIF.
  ENDMETHOD.
  METHOD parameter.
    DATA lv_type TYPE string.
    lv_type = to_lower( is_param-type ).
    IF iv_intf IS NOT INITIAL.
      lv_type = to_lower( iv_intf ) && `=>` && lv_type.
    ENDIF.
    rv_json = node( iv_id && `/parameter/` && is_param-name )
      && f( iv_name = 'name' iv_value = to_lower( is_param-name ) )
      && f( iv_name = 'type' iv_value = lv_type )
      && f( iv_name = 'local_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = iv_local - strlen( is_param-name ) ) ) )
      && f( iv_name = 'remote_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = iv_remote - strlen( is_param-name ) ) ) )
      && f( iv_name = 'shape' iv_value = is_param-shape )
      && f( iv_name = 'table' iv_value = |{ xsdbool( is_param-shape = 'table' ) }| )
      && f( iv_name = 'log' iv_value = |{ is_param-is_log }| )
      && f( iv_name = 'is_' && is_param-kind iv_value = 'X' ) && `}`.
  ENDMETHOD.
  METHOD use_node.
    DATA ls_range TYPE zcl_stg_segw_gen=>ty_map_range.
    DATA lt_ranges TYPE zcl_stg_segw_gen=>tt_map_range.
    DATA lv_ranges TYPE string.
    DATA lv_sem TYPE string.
    DATA lv_node TYPE string.
    lv_node = iv_id && `/mapping/` && is_use-prop-uuid.
    lt_ranges = is_use-prop-ranges.
    SORT lt_ranges BY semantics.
    LOOP AT lt_ranges INTO ls_range.
      CASE ls_range-semantics.
        WHEN 'H'.
          lv_sem = 'high'.
        WHEN 'L'.
          lv_sem = 'low'.
        WHEN 'O'.
          lv_sem = 'option'.
        WHEN 'S'.
          lv_sem = 'sign'.
        WHEN OTHERS.
          lv_sem = to_lower( ls_range-component ).
      ENDCASE.
      add( EXPORTING iv_item = node( lv_node && `/range/` && ls_range-semantics )
        && f( iv_name = 'parameter' iv_value = to_lower( is_use-param-name ) )
        && f( iv_name = 'field' iv_value = to_lower( is_use-property-abap_field ) )
        && f( iv_name = 'component' iv_value = to_lower( ls_range-component ) )
        && f( iv_name = 'semantic' iv_value = lv_sem ) && `}` CHANGING cv_array = lv_ranges ).
    ENDLOOP.
    rv_json = node( lv_node )
      && f( iv_name = 'result_target' iv_value = iv_target )
      && f( iv_name = 'parameter' iv_value = to_lower( is_use-param-name ) )
      && f( iv_name = 'parameter_type' iv_value = is_use-param-type )
      && f( iv_name = 'property_type' iv_value = is_use-property-edm_type )
      && f( iv_name = 'component' iv_value = to_lower( is_use-prop-component ) )
      && f( iv_name = 'field' iv_value = to_lower( is_use-property-abap_field ) )
      && f( iv_name = 'property' iv_value = is_use-prop-property )
      && f( iv_name = 'direction' iv_value = is_use-prop-direction )
      && f( iv_name = 'key' iv_value = |{ is_use-property-is_key }| )
      && f( iv_name = 'table' iv_value = |{ xsdbool( is_use-param-shape = 'table' ) }| )
      && f( iv_name = 'has_ranges' iv_value = |{ xsdbool( lt_ranges IS NOT INITIAL ) }| )
      && `,"ranges":[` && lv_ranges && `]}`.
  ENDMETHOD.

  METHOD model.
    DATA lt_params TYPE zcl_osd_dsl_mapping=>tt_param.
    DATA lt_decl TYPE zcl_osd_dsl_mapping=>tt_param.
    DATA lt_mapped TYPE zcl_osd_dsl_mapping=>tt_param.
    DATA lt_log TYPE zcl_osd_dsl_mapping=>tt_param.
    DATA lt_const TYPE zcl_osd_dsl_mapping=>tt_param.
    DATA ls_param TYPE zcl_osd_dsl_mapping=>ty_param.
    DATA ls_constant TYPE zcl_osd_dsl_mapping=>ty_constant.
    DATA lt_inputs TYPE zcl_osd_dsl_mapping=>tt_use.
    DATA lt_outputs TYPE zcl_osd_dsl_mapping=>tt_use.
    DATA lt_ranges TYPE zcl_osd_dsl_mapping=>tt_use.
    DATA lt_filtered TYPE zcl_osd_dsl_mapping=>tt_use.
    DATA ls_use TYPE zcl_osd_dsl_mapping=>ty_use.
    DATA ls_mp TYPE zcl_stg_segw_gen=>ty_map_prop.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.
    DATA lt_sources TYPE zcl_osd_dsl_mapping=>tt_source.
    DATA ls_source TYPE zcl_osd_dsl_mapping=>ty_source.
    DATA lt_seen TYPE string_table.
    DATA lv_params TYPE string.
    DATA lv_decl TYPE string.
    DATA lv_inputs TYPE string.
    DATA lv_outputs TYPE string.
    DATA lv_filters TYPE string.
    DATA lv_constants TYPE string.
    DATA lv_tables TYPE string.
    DATA lv_nav TYPE string.
    DATA lv_vars TYPE string.
    DATA lv_keys TYPE string.
    DATA lv_item TYPE string.
    DATA lv_intf TYPE string.
    DATA lv_out TYPE string.
    DATA lv_var TYPE string.
    DATA lv_value TYPE string.
    DATA lv_builtin TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_w1 TYPE i VALUE 14.
    DATA lv_width TYPE i VALUE 21.
    DATA lv_groups TYPE string.
    DATA lv_kind TYPE string.
    DATA lv_group_params TYPE string.
    DATA lv_type TYPE string.
    DATA lv_target TYPE string.
    FIELD-SYMBOLS <param> TYPE zcl_osd_dsl_mapping=>ty_param.

    lv_target = 'er_entity'.
    IF is_op-type = 'Q'.
      lv_target = 'ls_entityset'.
    ENDIF.
    IF is_op-mapping_kind = 'SHLP'.
      LOOP AT is_op-props INTO ls_mp.
        CLEAR ls_use.
        ls_use-property = zcl_osd_dsl_mapping=>property_named(
          EXPORTING is_type = is_type iv_name = ls_mp-property IMPORTING ev_found = lv_found ).
        IF lv_found = abap_false.
          CONTINUE.
        ENDIF.
        ls_use-prop-uuid = ls_mp-uuid.
        ls_use-prop-property = ls_mp-property.
        ls_use-prop-direction = ls_mp-direction.
        ls_use-prop-component = zcl_stg_segw_gen=>last_segment( ls_mp-ds_att_path ).
        ls_use-param-name = ls_mp-ds_att_path.
        IF ls_mp-direction = 'I'.
          APPEND ls_use TO lt_inputs.
        ELSEIF ls_mp-direction = 'O'.
          APPEND ls_use TO lt_outputs.
        ENDIF.
      ENDLOOP.
    ELSE.
      lt_params = zcl_osd_dsl_mapping=>used_parameters(
        is_op = is_op it_signature = zcl_stg_segw_fugr=>signature( is_op-function_name ) ).
      LOOP AT lt_params INTO ls_param WHERE type IS INITIAL.
        RETURN.
      ENDLOOP.
      lv_intf = zcl_osd_dsl_mapping=>bop_interface( iv_fm = is_op-function_name it_artifacts = is_model-artifacts ).
      lt_inputs = zcl_osd_dsl_mapping=>uses( it_params = lt_params is_type = is_type iv_direction = 'I' ).
      lt_outputs = zcl_osd_dsl_mapping=>uses( it_params = lt_params is_type = is_type iv_direction = 'O' ).
      lt_ranges = zcl_osd_dsl_mapping=>uses( it_params = lt_params is_type = is_type iv_direction = 'I' iv_ranges = abap_true ).
    ENDIF.
    IF is_op-type <> 'Q' AND is_op-type <> 'R' AND is_op-type <> 'C' AND is_op-type <> 'U' AND is_op-type <> 'D'.
      RETURN.
    ENDIF.
    IF is_op-mapping_kind = 'SHLP' AND is_op-type <> 'Q' AND is_op-type <> 'R'.
      RETURN.
    ENDIF.
    LOOP AT lt_params INTO ls_param.
      add( EXPORTING iv_item = parameter( is_param = ls_param iv_id = iv_id iv_intf = lv_intf ) CHANGING cv_array = lv_params ).
      lv_w1 = nmax( val1 = lv_w1 val2 = strlen( ls_param-name ) ).
      lv_width = nmax( val1 = lv_width val2 = strlen( ls_param-name ) ).
      IF ls_param-is_log = abap_true.
        APPEND ls_param TO lt_log.
      ELSEIF ls_param-props IS NOT INITIAL OR ls_param-ranges IS NOT INITIAL.
        APPEND ls_param TO lt_mapped.
      ELSE.
        APPEND ls_param TO lt_const.
      ENDIF.
      LOOP AT ls_param-constants INTO ls_constant.
        lv_value = ls_constant-value.
        lv_builtin = 'INT4'.
        IF strlen( lv_value ) >= 2 AND lv_value(1) = `'`.
          lv_value = substring( val = lv_value off = 1 len = strlen( lv_value ) - 2 ).
          lv_value = replace( val = lv_value sub = `''` with = `'` occ = 0 ).
          lv_builtin = 'CHAR'.
        ENDIF.
        add( EXPORTING iv_item = node( iv_id && `/parameter/` && ls_param-name && `/constant/` && ls_constant-uuid )
          && f( iv_name = 'parameter' iv_value = to_lower( ls_param-name ) )
          && f( iv_name = 'component' iv_value = to_lower( ls_constant-component ) )
          && f( iv_name = 'via_line' iv_value = |{ xsdbool( ls_param-shape = 'table' AND ls_constant-component IS NOT INITIAL ) }| )
          && f( iv_name = 'parameter_type' iv_value = ls_param-type )
          && f( iv_name = 'value' iv_value = lv_value )
          && `,"value@type":` && node( iv_id && `/parameter/` && ls_param-name && `/constant/` && ls_constant-uuid && `/type` )
          && f( iv_name = 'built_in' iv_value = lv_builtin )
          && f( iv_name = 'length' iv_value = '255' ) && `}}` CHANGING cv_array = lv_constants ).
      ENDLOOP.
      IF ls_param-shape = 'table' AND ls_param-constants IS NOT INITIAL.
        add( EXPORTING iv_item = parameter( is_param = ls_param iv_id = iv_id iv_intf = lv_intf ) CHANGING cv_array = lv_tables ).
      ENDIF.
    ENDLOOP.
* The editor sorts underscores as slashes, with log and constants last.
    LOOP AT lt_mapped ASSIGNING <param>.
      <param>-sort_key = zcl_osd_dsl_mapping=>sort_key( <param>-name ).
    ENDLOOP.
    SORT lt_mapped BY sort_key.
    LOOP AT lt_const ASSIGNING <param>.
      <param>-sort_key = zcl_osd_dsl_mapping=>sort_key( <param>-name ).
    ENDLOOP.
    SORT lt_const BY sort_key.
    lt_decl = lt_mapped.
    APPEND LINES OF lt_log TO lt_decl.
    APPEND LINES OF lt_const TO lt_decl.
    LOOP AT lt_decl INTO ls_param.
      add( EXPORTING iv_item = parameter( is_param = ls_param iv_id = iv_id iv_intf = lv_intf ) CHANGING cv_array = lv_decl ).
    ENDLOOP.
    DO 4 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'importing'.
        WHEN 2.
          lv_kind = 'exporting'.
        WHEN 3.
          lv_kind = 'tables'.
        WHEN 4.
          lv_kind = 'changing'.
      ENDCASE.
      CLEAR lv_group_params.
      LOOP AT lt_params INTO ls_param WHERE kind = lv_kind.
        add( EXPORTING iv_item = parameter( is_param = ls_param iv_id = iv_id iv_intf = lv_intf iv_local = lv_w1 iv_remote = lv_width ) CHANGING cv_array = lv_group_params ).
      ENDLOOP.
      IF lv_group_params IS NOT INITIAL.
        add( EXPORTING iv_item = node( iv_id && `/module` ) && f( iv_name = 'is_' && lv_kind iv_value = 'X' )
          && `,"parameters":[` && lv_group_params && `]}` CHANGING cv_array = lv_groups ).
      ENDIF.
    ENDDO.
    LOOP AT lt_inputs INTO ls_use.
      add( EXPORTING iv_item = use_node( is_use = ls_use iv_id = iv_id iv_target = lv_target ) CHANGING cv_array = lv_inputs ).
      IF is_op-mapping_kind <> 'RFC'.
        CONTINUE.
      ENDIF.
      lt_sources = zcl_osd_dsl_mapping=>source_sets( is_model = is_model is_type = is_type is_property = ls_use-property ).
      LOOP AT lt_sources INTO ls_source.
        lv_var = to_lower( ls_source-entity-tech_name ).
        IF strlen( lv_var ) > 16.
          lv_var = substring( val = lv_var len = 16 ).
        ENDIF.
        lv_item = use_node( is_use = ls_use iv_id = iv_id iv_target = lv_target ).
        lv_item = substring( val = lv_item len = strlen( lv_item ) - 1 )
          && f( iv_name = 'set' iv_value = ls_source-set_name )
          && f( iv_name = 'variable' iv_value = lv_var )
          && f( iv_name = 'source_field' iv_value = to_lower( ls_source-field ) ) && `}`.
        IF is_op-type = 'Q'.
          add( EXPORTING iv_item = lv_item CHANGING cv_array = lv_nav ).
        ELSE.
          READ TABLE lt_seen WITH KEY table_line = ls_source-set_name TRANSPORTING NO FIELDS.
          IF sy-subrc <> 0.
            add( EXPORTING iv_item = lv_item CHANGING cv_array = lv_nav ).
            APPEND ls_source-set_name TO lt_seen.
          ENDIF.
        ENDIF.
        READ TABLE lt_seen WITH KEY table_line = ls_source-entity-name TRANSPORTING NO FIELDS.
        IF sy-subrc <> 0.
          add( EXPORTING iv_item = node( iv_id && `/source/` && ls_source-entity-name )
            && f( iv_name = 'variable' iv_value = lv_var )
            && f( iv_name = 'type_stem' iv_value = to_lower( ls_source-entity-type_stem ) ) && `}` CHANGING cv_array = lv_vars ).
          APPEND ls_source-entity-name TO lt_seen.
        ENDIF.
      ENDLOOP.
    ENDLOOP.
    LOOP AT lt_outputs INTO ls_use.
      IF is_op-type = 'Q' AND is_op-mapping_kind = 'RFC'.
        IF lv_out IS INITIAL AND ls_use-param-shape = 'table'.
          lv_out = to_lower( ls_use-param-name ).
        ENDIF.
        IF lv_out IS INITIAL OR to_lower( ls_use-param-name ) <> lv_out.
          CONTINUE.
        ENDIF.
      ENDIF.
      add( EXPORTING iv_item = use_node( is_use = ls_use iv_id = iv_id iv_target = lv_target ) CHANGING cv_array = lv_outputs ).
    ENDLOOP.
    lt_filtered = lt_inputs.
    APPEND LINES OF lt_ranges TO lt_filtered.
    LOOP AT lt_filtered INTO ls_use.
      add( EXPORTING iv_item = use_node( is_use = ls_use iv_id = iv_id iv_target = lv_target ) CHANGING cv_array = lv_filters ).
    ENDLOOP.
    LOOP AT is_type-properties INTO ls_property WHERE is_key = abap_true.
      lv_value = `ls_request_input_data-` && to_lower( ls_property-abap_field ).
      LOOP AT lt_outputs INTO ls_use WHERE prop-property = ls_property-name.
        lv_value = path( is_param = ls_use-param iv_component = ls_use-prop-component iv_line = xsdbool( ls_use-param-shape = 'table' ) ).
        EXIT.
      ENDLOOP.
      add( EXPORTING iv_item = node( iv_id && `/key/` && ls_property-name )
        && f( iv_name = 'field' iv_value = to_upper( ls_property-abap_field ) )
        && f( iv_name = 'source' iv_value = lv_value ) && `}` CHANGING cv_array = lv_keys ).
    ENDLOOP.
    lv_type = to_lower( is_model-mpc ) && `=>ts_` && to_lower( is_type-type_stem ).
    rv_json = node( iv_id )
      && f( iv_name = 'method' iv_value = is_op-method )
      && f( iv_name = 'is_' && to_lower( is_op-type ) iv_value = 'X' )
      && f( iv_name = 'result_target' iv_value = lv_target )
      && f( iv_name = 'has_inputs' iv_value = |{ xsdbool( lv_inputs IS NOT INITIAL ) }| )
      && f( iv_name = 'has_filters' iv_value = |{ xsdbool( lv_filters IS NOT INITIAL ) }| )
      && f( iv_name = 'has_navigation' iv_value = |{ xsdbool( lv_nav IS NOT INITIAL ) }| )
      && f( iv_name = 'has_constants' iv_value = |{ xsdbool( lv_constants IS NOT INITIAL ) }| )
      && f( iv_name = 'has_constant_tables' iv_value = |{ xsdbool( lv_tables IS NOT INITIAL ) }| )
      && f( iv_name = 'type' iv_value = lv_type )
      && f( iv_name = 'mpc' iv_value = to_lower( is_model-mpc ) )
      && f( iv_name = 'interface' iv_value = lv_intf )
      && `,"module":` && node( iv_id && `/module` ) && f( iv_name = 'name' iv_value = is_op-function_name ) && `}`
      && `,"exceptions":` && node( iv_id && `/exceptions` )
      && f( iv_name = 'system_failure_code' iv_value = '1000' )
      && f( iv_name = 'communication_failure_code' iv_value = '1001' )
      && f( iv_name = 'others_code' iv_value = '1002' )
      && f( iv_name = 'caught_code' iv_value = '1001' )
      && f( iv_name = 'local_width' iv_value = |{ lv_w1 }| )
      && f( iv_name = 'remote_width' iv_value = |{ lv_width }| )
      && f( iv_name = 'local_system_failure_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_w1 - 14 ) ) )
      && f( iv_name = 'local_communication_failure_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_w1 - 21 ) ) )
      && f( iv_name = 'local_others_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_w1 - 6 ) ) )
      && f( iv_name = 'remote_system_failure_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_width - 14 ) ) )
      && f( iv_name = 'remote_communication_failure_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_width - 21 ) ) )
      && f( iv_name = 'remote_others_gap' iv_value = repeat( val = ` ` occ = nmax( val1 = 0 val2 = lv_width - 6 ) ) )
      && `}`
      && `,"log":` && node( iv_id && `/log` ) && f( iv_name = 'name' iv_value = to_lower( is_op-log_attr ) ) && `}`
      && `,"out_table":` && node( iv_id && `/parameter/` && to_upper( lv_out ) ) && f( iv_name = 'name' iv_value = lv_out ) && `}`
      && `,"parameters":[` && lv_params && `],"declarations":[` && lv_decl
      && `],"groups":[` && lv_groups && `],"constants":[` && lv_constants
      && `],"constant_tables":[` && lv_tables && `],"inputs":[` && lv_inputs
      && `],"outputs":[` && lv_outputs && `],"filters":[` && lv_filters
      && `],"navigation":[` && lv_nav && `],"source_vars":[` && lv_vars
      && `],"keys":[` && lv_keys && `]}`.
  ENDMETHOD.
ENDCLASS.
