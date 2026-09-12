CLASS zcl_stg_segw_gen_rfc DEFINITION PUBLIC CREATE PUBLIC.
* Stage 3 of segw-gen in ABAP: the DPC methods of an operation mapped to a
* function module (data source type 2) or a search help (type 6), the
* templates of tools/segw-gen-mapping.mjs line for line. The module's
* signature comes from ZSTG_FM_PARAM (zcl_stg_segw_fugr); without it, or
* with a parameter whose type is unknown, rfc_method gives nothing and the
* DPC keeps the stub segw-gen writes in that case.
  PUBLIC SECTION.
    CONSTANTS gc_shlp_interface TYPE string VALUE '/IWBEP/IF_SB_GENDPC_SHLP_DATA'.

    CLASS-METHODS rfc_method
      IMPORTING
        is_op          TYPE zcl_stg_segw_gen=>ty_operation
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
        is_model       TYPE zcl_stg_segw_gen=>ty_model
        it_signature   TYPE zcl_stg_segw_fugr=>tt_param
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS shlp_method
      IMPORTING
        is_op          TYPE zcl_stg_segw_gen=>ty_operation
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS shlp_implementation
      RETURNING
        VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
* a mapped property with the parameter component it goes to
    TYPES: BEGIN OF ty_prop,
             uuid      TYPE string,
             property  TYPE string,
             direction TYPE string,
             component TYPE string,
             ranges    TYPE zcl_stg_segw_gen=>tt_map_range,
           END OF ty_prop.
    TYPES tt_prop TYPE STANDARD TABLE OF ty_prop WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_constant,
             component TYPE string,
             value     TYPE string,
           END OF ty_constant.
    TYPES tt_constant TYPE STANDARD TABLE OF ty_constant WITH DEFAULT KEY.
* one variable per function module parameter the mapping touches
    TYPES: BEGIN OF ty_param,
             name      TYPE string,
             kind      TYPE string,
             type      TYPE string,
             shape     TYPE string,
             is_log    TYPE abap_bool,
             constants TYPE tt_constant,
             props     TYPE tt_prop,
             ranges    TYPE tt_prop,
           END OF ty_param.
    TYPES tt_param TYPE STANDARD TABLE OF ty_param WITH DEFAULT KEY.
* an output or input with its parameter and property resolved
    TYPES: BEGIN OF ty_use,
             prop      TYPE ty_prop,
             param     TYPE ty_param,
             property  TYPE zcl_stg_segw_gen=>ty_property,
           END OF ty_use.
    TYPES tt_use TYPE STANDARD TABLE OF ty_use WITH DEFAULT KEY.
* an entity set that navigates into the entity and hands over a key
    TYPES: BEGIN OF ty_source,
             set_name TYPE string,
             entity   TYPE zcl_stg_segw_gen=>ty_entity_type,
             field    TYPE string,
             use      TYPE ty_use,
           END OF ty_source.
    TYPES tt_source TYPE STANDARD TABLE OF ty_source WITH DEFAULT KEY.

    CLASS-METHODS used_parameters
      IMPORTING
        is_op            TYPE zcl_stg_segw_gen=>ty_operation
        it_signature     TYPE zcl_stg_segw_fugr=>tt_param
      RETURNING
        VALUE(rt_params) TYPE tt_param.

    CLASS-METHODS kind_by_name
      IMPORTING
        iv_name        TYPE string
      RETURNING
        VALUE(rv_kind) TYPE string.

    CLASS-METHODS shape_by_name
      IMPORTING
        iv_name         TYPE string
      RETURNING
        VALUE(rv_shape) TYPE string.

    CLASS-METHODS bop_interface
      IMPORTING
        iv_fm          TYPE string
        it_artifacts   TYPE zcl_stg_segw_gen=>tt_artifact
      RETURNING
        VALUE(rv_name) TYPE string.

    CLASS-METHODS type_of
      IMPORTING
        is_param       TYPE ty_param
        iv_intf        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS pad
      IMPORTING
        iv_text        TYPE string
        iv_width       TYPE i
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS call_blocks
      IMPORTING
        it_params      TYPE tt_param
        iv_indent      TYPE string
        iv_width       TYPE i
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS call_function
      IMPORTING
        it_params      TYPE tt_param
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS param_path
      IMPORTING
        is_param       TYPE ty_param
        iv_component   TYPE string
        iv_via_line    TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS constant_lines
      IMPORTING
        it_params      TYPE tt_param
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS append_constant_lines
      IMPORTING
        it_params      TYPE tt_param
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS declarations
      IMPORTING
        it_params      TYPE tt_param
        iv_intf        TYPE string
        it_extra       TYPE string_table
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS key_lines
      IMPORTING
        it_params      TYPE tt_param
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_source      TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS input_lines
      IMPORTING
        it_params      TYPE tt_param
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_keys_too    TYPE abap_bool
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS source_sets
      IMPORTING
        is_model          TYPE zcl_stg_segw_gen=>ty_model
        is_type           TYPE zcl_stg_segw_gen=>ty_entity_type
        is_property       TYPE zcl_stg_segw_gen=>ty_property
      RETURNING
        VALUE(rt_sources) TYPE tt_source.

    CLASS-METHODS property_named
      IMPORTING
        is_type            TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_name            TYPE string
      EXPORTING
        ev_found           TYPE abap_bool
      RETURNING
        VALUE(rs_property) TYPE zcl_stg_segw_gen=>ty_property.

    CLASS-METHODS uses
      IMPORTING
        it_params      TYPE tt_param
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_direction   TYPE string
        iv_ranges      TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(rt_uses) TYPE tt_use.

    CLASS-METHODS error_handling
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS save_log
      IMPORTING
        iv_log_attr    TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS commit
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS get_destination
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS request_banner
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS sort_key
      IMPORTING
        iv_name       TYPE string
      RETURNING
        VALUE(rv_key) TYPE string.

    CLASS-METHODS shlp_result_case
      IMPORTING
        it_outputs     TYPE tt_use
        iv_target      TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_stg_segw_gen_rfc IMPLEMENTATION.

* ------------------------------------------------------------ the mapping

  METHOD kind_by_name.
* what a parameter is when the signature does not say: SAP naming
* (IV_/IS_/IT_ or I_ importing, E.. exporting, C.. changing, else tables)
    DATA lv_c1 TYPE string.
    DATA lv_c2 TYPE string.
    DATA lv_c3 TYPE string.

    IF strlen( iv_name ) >= 3.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
      lv_c3 = substring( val = iv_name off = 2 len = 1 ).
    ELSEIF strlen( iv_name ) = 2.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
    ENDIF.
    IF ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' )
        AND ( lv_c2 = '_' OR ( ( lv_c2 = 'V' OR lv_c2 = 'S' OR lv_c2 = 'T' ) AND lv_c3 = '_' ) ).
      CASE lv_c1.
        WHEN 'I'.
          rv_kind = 'importing'.
        WHEN 'E'.
          rv_kind = 'exporting'.
        WHEN 'C'.
          rv_kind = 'changing'.
      ENDCASE.
    ELSE.
      rv_kind = 'tables'.
    ENDIF.
  ENDMETHOD.

  METHOD shape_by_name.
* IT_/ET_/CT_ or T_ is a table, IS_/ES_/CS_ or S_ a structure, else a scalar
    DATA lv_c1 TYPE string.
    DATA lv_c2 TYPE string.
    DATA lv_c3 TYPE string.

    IF strlen( iv_name ) >= 3.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
      lv_c3 = substring( val = iv_name off = 2 len = 1 ).
    ELSEIF strlen( iv_name ) = 2.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
    ENDIF.
    IF ( lv_c1 = 'T' AND lv_c2 = '_' )
        OR ( ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' ) AND lv_c2 = 'T' AND lv_c3 = '_' ).
      rv_shape = 'table'.
    ELSEIF ( lv_c1 = 'S' AND lv_c2 = '_' )
        OR ( ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' ) AND lv_c2 = 'S' AND lv_c3 = '_' ).
      rv_shape = 'structure'.
    ELSE.
      rv_shape = 'scalar'.
    ENDIF.
  ENDMETHOD.

  METHOD used_parameters.
    DATA ls_mp       TYPE zcl_stg_segw_gen=>ty_map_prop.
    DATA ls_range    TYPE zcl_stg_segw_gen=>ty_map_range.
    DATA ls_sig      TYPE zcl_stg_segw_fugr=>ty_param.
    DATA ls_param    TYPE ty_param.
    DATA ls_prop     TYPE ty_prop.
    DATA ls_constant TYPE ty_constant.
    DATA lv_root     TYPE string.
    DATA lv_component TYPE string.
    DATA lv_at       TYPE i.
    DATA lv_has_ranges TYPE abap_bool.
    FIELD-SYMBOLS <ls_param> TYPE ty_param.

    LOOP AT is_op-props INTO ls_mp.
      lv_at = find( val = ls_mp-ds_att_path sub = '\' ).
      IF lv_at < 0.
        lv_root = ls_mp-ds_att_path.
        CLEAR lv_component.
      ELSE.
        lv_root = substring( val = ls_mp-ds_att_path len = lv_at ).
        lv_component = substring( val = ls_mp-ds_att_path off = lv_at + 1 ).
        lv_at = find( val = lv_component sub = '\' ).
        IF lv_at >= 0.
          lv_component = substring( val = lv_component len = lv_at ).
        ENDIF.
      ENDIF.
      READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      IF sy-subrc <> 0.
        CLEAR ls_param.
        ls_param-name  = lv_root.
        ls_param-shape = shape_by_name( lv_root ).
        LOOP AT it_signature INTO ls_sig WHERE name = lv_root.
          ls_param-kind = ls_sig-kind.
          ls_param-type = ls_sig-type.
        ENDLOOP.
        IF ls_param-kind IS INITIAL.
          ls_param-kind = kind_by_name( lv_root ).
        ENDIF.
        APPEND ls_param TO rt_params.
        READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      ENDIF.
      CLEAR ls_prop.
      ls_prop-uuid      = ls_mp-uuid.
      ls_prop-property  = ls_mp-property.
      ls_prop-direction = ls_mp-direction.
      ls_prop-component = lv_component.
      LOOP AT is_op-ranges INTO ls_range WHERE mp_uuid = ls_mp-uuid.
        APPEND ls_range TO ls_prop-ranges.
      ENDLOOP.
      lv_has_ranges = xsdbool( ls_prop-ranges IS NOT INITIAL ).
      IF ( lv_component IS NOT INITIAL OR lv_has_ranges = abap_true ) AND <ls_param>-shape = 'scalar'.
        <ls_param>-shape = 'structure'.
      ENDIF.
      IF lv_has_ranges = abap_true.
        <ls_param>-shape = 'table'.
        APPEND ls_prop TO <ls_param>-ranges.
      ELSEIF ls_mp-has_constant = abap_true.
        ls_constant-component = lv_component.
        ls_constant-value     = ls_mp-constant.
        APPEND ls_constant TO <ls_param>-constants.
      ELSE.
        APPEND ls_prop TO <ls_param>-props.
      ENDIF.
    ENDLOOP.
    IF is_op-log_attr IS NOT INITIAL.
      lv_root = is_op-log_attr.
      lv_at = find( val = lv_root sub = '\' ).
      IF lv_at >= 0.
        lv_root = substring( val = lv_root len = lv_at ).
      ENDIF.
      READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      IF sy-subrc <> 0.
        CLEAR ls_param.
        ls_param-name  = lv_root.
        ls_param-shape = shape_by_name( lv_root ).
        LOOP AT it_signature INTO ls_sig WHERE name = lv_root.
          ls_param-kind = ls_sig-kind.
          ls_param-type = ls_sig-type.
        ENDLOOP.
        IF ls_param-kind IS INITIAL.
          ls_param-kind = kind_by_name( lv_root ).
        ENDIF.
        APPEND ls_param TO rt_params.
        READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      ENDIF.
      <ls_param>-shape  = 'table'.
      <ls_param>-is_log = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD bop_interface.
* SEGW copies the DDIC types the module uses into one generated interface
* per module (artifact type BOP), IF_ + the module name cut to 30 with a
* number where it collides. Newer trees say which module (RFC_NAME), older
* ones only have the name; the last match is the current one.
    DATA ls_art  TYPE zcl_stg_segw_gen=>ty_artifact.
    DATA lv_stem TYPE string.
    DATA lv_at   TYPE i.
    DATA lv_len  TYPE i.

    LOOP AT it_artifacts INTO ls_art WHERE art_type = 'BOP' AND rfc_name = iv_fm.
      rv_name = ls_art-name.
    ENDLOOP.
    IF rv_name IS NOT INITIAL.
      RETURN.
    ENDIF.
    LOOP AT it_artifacts INTO ls_art WHERE art_type = 'BOP'.
      lv_stem = ls_art-name.
      IF strlen( lv_stem ) > 0 AND lv_stem(1) = '/'.
        lv_at = find( val = lv_stem sub = '/' off = 1 ).
        IF lv_at > 0.
          lv_stem = substring( val = lv_stem off = lv_at + 1 ).
        ENDIF.
      ENDIF.
      IF strlen( lv_stem ) >= 3 AND substring( val = lv_stem len = 3 ) = 'IF_'.
        lv_stem = substring( val = lv_stem off = 3 ).
      ENDIF.
      lv_len = strlen( lv_stem ).
      WHILE lv_len > 0 AND substring( val = lv_stem off = lv_len - 1 len = 1 ) CO '0123456789'.
        lv_len = lv_len - 1.
      ENDWHILE.
      lv_stem = substring( val = lv_stem len = lv_len ).
      IF lv_stem IS INITIAL.
        rv_name = ls_art-name.
        CONTINUE.
      ENDIF.
      IF strlen( iv_fm ) >= strlen( lv_stem ) AND substring( val = iv_fm len = strlen( lv_stem ) ) = lv_stem.
        rv_name = ls_art-name.
      ELSEIF strlen( lv_stem ) >= strlen( iv_fm ) AND substring( val = lv_stem len = strlen( iv_fm ) ) = iv_fm.
        rv_name = ls_art-name.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD type_of.
    IF is_param-type IS INITIAL.
      RETURN.
    ENDIF.
    IF iv_intf IS NOT INITIAL.
      rv_text = |{ to_lower( iv_intf ) }=>{ to_lower( is_param-type ) }|.
    ELSE.
      rv_text = to_lower( is_param-type ).
    ENDIF.
  ENDMETHOD.

  METHOD pad.
    rv_text = iv_text.
    IF strlen( rv_text ) < iv_width.
      rv_text = rv_text && repeat( val = ` ` occ = iv_width - strlen( rv_text ) ).
    ENDIF.
  ENDMETHOD.

  METHOD sort_key.
    rv_key = replace( val = iv_name sub = '_' with = '/' occ = 0 ).
  ENDMETHOD.

  METHOD property_named.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.

    CLEAR ev_found.
    LOOP AT is_type-properties INTO ls_property.
      IF ls_property-name = iv_name.
        rs_property = ls_property.
        ev_found = abap_true.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD uses.
* the props (or the ranges) of every parameter in a direction, with the
* entity property they name; unknown properties are left out
    DATA ls_param TYPE ty_param.
    DATA ls_prop  TYPE ty_prop.
    DATA ls_use   TYPE ty_use.
    DATA lv_found TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      IF iv_ranges = abap_true.
        LOOP AT ls_param-ranges INTO ls_prop.
          CLEAR ls_use.
          ls_use-prop  = ls_prop.
          ls_use-param = ls_param.
          ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
          IF lv_found = abap_true.
            APPEND ls_use TO rt_uses.
          ENDIF.
        ENDLOOP.
      ELSE.
        LOOP AT ls_param-props INTO ls_prop WHERE direction = iv_direction.
          CLEAR ls_use.
          ls_use-prop  = ls_prop.
          ls_use-param = ls_param.
          ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
          IF lv_found = abap_true.
            APPEND ls_use TO rt_uses.
          ENDIF.
        ENDLOOP.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

* --------------------------------------------------------- text blocks

  METHOD call_blocks.
    DATA ls_param   TYPE ty_param.
    DATA lv_kind    TYPE string.
    DATA lv_keyword TYPE string.

    DO 4 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'importing'.
          lv_keyword = 'EXPORTING'.
        WHEN 2.
          lv_kind = 'exporting'.
          lv_keyword = 'IMPORTING'.
        WHEN 3.
          lv_kind = 'tables'.
          lv_keyword = 'TABLES'.
        WHEN 4.
          lv_kind = 'changing'.
          lv_keyword = 'CHANGING'.
      ENDCASE.
      READ TABLE it_params WITH KEY kind = lv_kind TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      rv_text = rv_text && |{ iv_indent }{ lv_keyword }\n|.
      LOOP AT it_params INTO ls_param WHERE kind = lv_kind.
        rv_text = rv_text && |{ iv_indent }  { pad( iv_text = to_lower( ls_param-name ) iv_width = iv_width ) } = { to_lower( ls_param-name ) }\n|.
      ENDLOOP.
    ENDDO.
  ENDMETHOD.

  METHOD call_function.
    DATA ls_param TYPE ty_param.
    DATA lv_width TYPE i.
    DATA lv_w1    TYPE i.

    lv_width = 21.
    lv_w1 = 14.
    LOOP AT it_params INTO ls_param.
      IF strlen( ls_param-name ) > lv_width.
        lv_width = strlen( ls_param-name ).
      ENDIF.
      IF strlen( ls_param-name ) > lv_w1.
        lv_w1 = strlen( ls_param-name ).
      ENDIF.
    ENDLOOP.
    rv_text = | IF lv_destination IS INITIAL OR lv_destination EQ 'NONE'.\n|
      && |\n|
      && |   TRY.\n|
      && |       CALL FUNCTION lv_rfc_name\n|
      && call_blocks( it_params = it_params iv_indent = `         ` iv_width = lv_w1 )
      && |         EXCEPTIONS\n|
      && |           { pad( iv_text = 'system_failure' iv_width = lv_w1 ) } = 1000  MESSAGE lv_exc_msg\n|
      && |           { pad( iv_text = 'OTHERS' iv_width = lv_w1 ) } = 1002.\n|
      && |\n|
      && |       lv_subrc = sy-subrc.\n|
      && |*in case of co-deployment the exception is raised and needs to be caught\n|
      && |     CATCH cx_root INTO lx_root.\n|
      && |       lv_subrc = 1001.\n|
      && |       lv_exc_msg = lx_root->if_message~get_text( ).\n|
      && |   ENDTRY.\n|
      && |\n|
      && | ELSE.\n|
      && |\n|
      && |   CALL FUNCTION lv_rfc_name DESTINATION lv_destination\n|
      && call_blocks( it_params = it_params iv_indent = `     ` iv_width = lv_width )
      && |     EXCEPTIONS\n|
      && |       { pad( iv_text = 'system_failure' iv_width = lv_width ) } = 1000  MESSAGE lv_exc_msg\n|
      && |       { pad( iv_text = 'communication_failure' iv_width = lv_width ) } = 1001  MESSAGE lv_exc_msg\n|
      && |       { pad( iv_text = 'OTHERS' iv_width = lv_width ) } = 1002.\n|
      && |\n|
      && |   lv_subrc = sy-subrc.\n|
      && |\n|
      && | ENDIF.\n|.
  ENDMETHOD.

  METHOD error_handling.
    rv_text = |*-------------------------------------------------------------\n|
      && |*  Map the RFC response to the caller interface - Only mapped attributes\n|
      && |*-------------------------------------------------------------\n|
      && |*-------------------------------------------------------------\n|
      && |* Error and exception handling\n|
      && |*-------------------------------------------------------------\n|
      && | IF lv_subrc <> 0.\n|
      && |* Execute the RFC exception handling process\n|
      && |   me->/iwbep/if_sb_dpc_comm_services~rfc_exception_handling(\n|
      && |     EXPORTING\n|
      && |       iv_subrc            = lv_subrc\n|
      && |       iv_exp_message_text = lv_exc_msg ).\n|
      && | ENDIF.\n|.
  ENDMETHOD.

  METHOD save_log.
    IF iv_log_attr IS INITIAL.
      RETURN.
    ENDIF.
    rv_text = |\n|
      && | IF { to_lower( iv_log_attr ) } IS NOT INITIAL.\n|
      && |   me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(\n|
      && |     EXPORTING\n|
      && |       iv_entity_type = iv_entity_name\n|
      && |       it_return      = { to_lower( iv_log_attr ) }\n|
      && |       it_key_tab     = it_key_tab ).\n|
      && | ENDIF.\n|.
  ENDMETHOD.

  METHOD commit.
    rv_text = |\n|
      && |* Call RFC commit work\n|
      && | me->/iwbep/if_sb_dpc_comm_services~commit_work(\n|
      && |        EXPORTING\n|
      && |          iv_rfc_dest = lv_destination\n|
      && |     ) .\n|.
  ENDMETHOD.

  METHOD get_destination.
    rv_text = |\n|
      && |* Get RFC destination\n|
      && | lo_dp_facade = /iwbep/if_mgw_conv_srv_runtime~get_dp_facade( ).\n|
      && | lv_destination = /iwbep/cl_sb_gen_dpc_rt_util=>get_rfc_destination( io_dp_facade = lo_dp_facade ).\n|
      && |\n|
      && |*-------------------------------------------------------------\n|
      && |*  Call RFC function module\n|
      && |*-------------------------------------------------------------\n|.
  ENDMETHOD.

  METHOD request_banner.
    rv_text = |*-------------------------------------------------------------\n|
      && |*  Map the runtime request to the RFC - Only mapped attributes\n|
      && |*-------------------------------------------------------------\n|
      && |* Get all input information from the technical request context object\n|
      && |* Since DPC works with internal property names and runtime API interface holds external property names\n|
      && |* the process needs to get the all needed input information from the technical request context object\n|.
  ENDMETHOD.

  METHOD param_path.
    IF iv_component IS NOT INITIAL.
      IF iv_via_line = abap_true.
        rv_text = |ls_{ to_lower( is_param-name ) }-{ to_lower( iv_component ) }|.
      ELSE.
        rv_text = |{ to_lower( is_param-name ) }-{ to_lower( iv_component ) }|.
      ENDIF.
    ELSE.
      rv_text = to_lower( is_param-name ).
    ENDIF.
  ENDMETHOD.

  METHOD constant_lines.
    DATA ls_param    TYPE ty_param.
    DATA ls_constant TYPE ty_constant.
    DATA lv_any      TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      IF ls_param-constants IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_any = abap_false.
        lv_any = abap_true.
        rv_text = |\n* Maps constant value to function module parameters\n|.
      ENDIF.
      LOOP AT ls_param-constants INTO ls_constant.
        rv_text = rv_text && | { param_path( is_param = ls_param iv_component = ls_constant-component iv_via_line = xsdbool( ls_param-shape = 'table' ) ) } = { ls_constant-value }.\n|.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD append_constant_lines.
    DATA ls_param TYPE ty_param.
    DATA lv_any   TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      IF ls_param-shape <> 'table' OR ls_param-constants IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_any = abap_false.
        lv_any = abap_true.
        rv_text = |\n* Append lines of table parameters in the function call\n|.
      ENDIF.
      rv_text = rv_text
        && | IF ls_{ to_lower( ls_param-name ) } IS NOT INITIAL.\n|
        && |   APPEND ls_{ to_lower( ls_param-name ) } TO { to_lower( ls_param-name ) }.\n|
        && | ENDIF.\n|.
    ENDLOOP.
  ENDMETHOD.

  METHOD declarations.
* the mapped parameters by name, the log table, the constant-only ones by
* name; a line variable for every table; then the fixed ones
    DATA lt_mapped  TYPE tt_param.
    DATA lt_log     TYPE tt_param.
    DATA lt_const   TYPE tt_param.
    DATA lt_ordered TYPE tt_param.
    DATA ls_param   TYPE ty_param.
    DATA lt_keys    TYPE string_table.
    DATA lv_key     TYPE string.
    DATA lv_other   TYPE string.
    DATA lv_at      TYPE i.
    DATA lv_extra   TYPE string.
    DATA lv_type    TYPE string.
    DATA lv_blank   TYPE string.

    LOOP AT it_params INTO ls_param.
      IF ls_param-is_log = abap_true.
        APPEND ls_param TO lt_log.
      ELSEIF ls_param-props IS NOT INITIAL OR ls_param-ranges IS NOT INITIAL.
        APPEND ls_param TO lt_mapped.
      ELSE.
        APPEND ls_param TO lt_const.
      ENDIF.
    ENDLOOP.
* a stable sort by the class editor's name order
    CLEAR lt_ordered.
    LOOP AT lt_mapped INTO ls_param.
      lv_key = sort_key( ls_param-name ).
      lv_at = 0.
      LOOP AT lt_keys INTO lv_other.
        IF lv_other > lv_key.
          lv_at = sy-tabix.
          EXIT.
        ENDIF.
      ENDLOOP.
      IF lv_at = 0.
        APPEND lv_key TO lt_keys.
        APPEND ls_param TO lt_ordered.
      ELSE.
        INSERT lv_key INTO lt_keys INDEX lv_at.
        INSERT ls_param INTO lt_ordered INDEX lv_at.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_log INTO ls_param.
      APPEND ls_param TO lt_ordered.
    ENDLOOP.
    CLEAR lt_keys.
    lt_mapped = lt_ordered.
    CLEAR lt_ordered.
    LOOP AT lt_const INTO ls_param.
      lv_key = sort_key( ls_param-name ).
      lv_at = 0.
      LOOP AT lt_keys INTO lv_other.
        IF lv_other > lv_key.
          lv_at = sy-tabix.
          EXIT.
        ENDIF.
      ENDLOOP.
      IF lv_at = 0.
        APPEND lv_key TO lt_keys.
        APPEND ls_param TO lt_ordered.
      ELSE.
        INSERT lv_key INTO lt_keys INDEX lv_at.
        INSERT ls_param INTO lt_ordered INDEX lv_at.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_ordered INTO ls_param.
      APPEND ls_param TO lt_mapped.
    ENDLOOP.
    lt_ordered = lt_mapped.

    LOOP AT lt_ordered INTO ls_param.
      IF ls_param-shape = 'table'.
        lv_blank = ` `.
      ELSE.
        CLEAR lv_blank.
      ENDIF.
      rv_text = rv_text && | DATA { to_lower( ls_param-name ) }{ lv_blank } TYPE { type_of( is_param = ls_param iv_intf = iv_intf ) }.\n|.
    ENDLOOP.
    LOOP AT lt_ordered INTO ls_param WHERE shape = 'table'.
      IF iv_intf IS NOT INITIAL.
        rv_text = rv_text && | DATA ls_{ to_lower( ls_param-name ) }  TYPE LINE OF { type_of( is_param = ls_param iv_intf = iv_intf ) }.\n|.
      ELSE.
        rv_text = rv_text && | DATA ls_{ to_lower( ls_param-name ) }  LIKE LINE OF { to_lower( ls_param-name ) }.\n|.
      ENDIF.
    ENDLOOP.
    rv_text = rv_text
      && | DATA lv_rfc_name TYPE tfdir-funcname.\n|
      && | DATA lv_destination TYPE rfcdest.\n|
      && | DATA lv_subrc TYPE syst-subrc.\n|
      && | DATA lv_exc_msg TYPE /iwbep/mgw_bop_rfc_excep_text.\n|
      && | DATA lx_root TYPE REF TO cx_root.\n|.
    LOOP AT it_extra INTO lv_extra.
      rv_text = rv_text && lv_extra && |\n|.
    ENDLOOP.
    rv_text = rv_text && | DATA lo_dp_facade TYPE REF TO /iwbep/if_mgw_dp_facade.\n|.
  ENDMETHOD.

  METHOD key_lines.
    DATA ls_param TYPE ty_param.
    DATA ls_prop  TYPE ty_prop.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.
    DATA lv_found TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      LOOP AT ls_param-props INTO ls_prop WHERE direction = 'I'.
        ls_property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
        IF lv_found = abap_false OR ls_property-is_key = abap_false.
          CONTINUE.
        ENDIF.
        rv_text = rv_text && | { param_path( is_param = ls_param iv_component = ls_prop-component ) } = { iv_source }-{ to_lower( ls_property-abap_field ) }.\n|.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD input_lines.
    DATA ls_param TYPE ty_param.
    DATA ls_prop  TYPE ty_prop.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.
    DATA lv_found TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      LOOP AT ls_param-props INTO ls_prop WHERE direction = 'I'.
        ls_property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
        IF lv_found = abap_false.
          CONTINUE.
        ENDIF.
        IF iv_keys_too = abap_false AND ls_property-is_key = abap_true.
          CONTINUE.
        ENDIF.
        rv_text = rv_text && | { param_path( is_param = ls_param iv_component = ls_prop-component ) } = ls_request_input_data-{ to_lower( ls_property-abap_field ) }.\n|.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD source_sets.
* the entity sets that navigate into this entity and hand over the key
* property through a referential constraint
    DATA ls_assoc  TYPE zcl_stg_segw_gen=>ty_association.
    DATA ls_rc     TYPE zcl_stg_segw_gen=>ty_constraint.
    DATA ls_left   TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set    TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_principal TYPE zcl_stg_segw_gen=>ty_property.
    DATA ls_source TYPE ty_source.
    DATA lv_found  TYPE abap_bool.

    LOOP AT is_model-associations INTO ls_assoc WHERE right_type = is_type-name.
      LOOP AT ls_assoc-constraints INTO ls_rc WHERE dependent = is_property-name.
        READ TABLE is_model-entity_types INTO ls_left WITH KEY name = ls_assoc-left_type.
        IF sy-subrc <> 0.
          CONTINUE.
        ENDIF.
        ls_principal = property_named( EXPORTING is_type = ls_left iv_name = ls_rc-principal IMPORTING ev_found = lv_found ).
        LOOP AT ls_left-entity_sets INTO ls_set.
          CLEAR ls_source.
          ls_source-set_name = ls_set-name.
          ls_source-entity   = ls_left.
          IF lv_found = abap_true.
            ls_source-field = ls_principal-abap_field.
          ELSE.
            ls_source-field = ls_rc-principal.
          ENDIF.
          APPEND ls_source TO rt_sources.
        ENDLOOP.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

* ------------------------------------------------------------ RFC method

  METHOD rfc_method.
    DATA lt_params  TYPE tt_param.
    DATA ls_param   TYPE ty_param.
    DATA lv_intf    TYPE string.
    DATA lv_mpc     TYPE string.
    DATA lv_ts      TYPE string.
    DATA lt_outputs TYPE tt_use.
    DATA lt_inputs  TYPE tt_use.
    DATA lt_ranges  TYPE tt_use.
    DATA ls_use     TYPE ty_use.
    DATA lt_extra   TYPE string_table.
    DATA lv_body    TYPE string.
    DATA lt_sources TYPE tt_source.
    DATA ls_source  TYPE ty_source.
    DATA lt_seen    TYPE string_table.
    DATA lt_nav     TYPE tt_source.
    DATA lt_vars    TYPE STANDARD TABLE OF zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_var     TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_out_table TYPE ty_param.
    DATA lv_has_out TYPE abap_bool.
    DATA lv_f       TYPE string.
    DATA lt_filtered TYPE tt_use.
    DATA ls_range   TYPE zcl_stg_segw_gen=>ty_map_range.
    DATA lt_comps   TYPE zcl_stg_segw_gen=>tt_map_range.
    DATA lv_sem     TYPE string.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.
    DATA lv_value   TYPE string.
    DATA lv_found   TYPE abap_bool.
    DATA lv_i       TYPE i.
    DATA lv_j       TYPE i.
    DATA ls_swap    TYPE zcl_stg_segw_gen=>ty_map_range.
    DATA lv_var     TYPE string.

    lt_params = used_parameters( is_op = is_op it_signature = it_signature ).
    LOOP AT lt_params INTO ls_param WHERE type IS INITIAL.
* no signature, no types: the BOP interface only says where the types
* live, not what they are called
      RETURN.
    ENDLOOP.
    lv_intf = bop_interface( iv_fm = is_op-function_name it_artifacts = is_model-artifacts ).
    lv_mpc = to_lower( is_model-mpc ).
    lv_ts = |{ lv_mpc }=>ts_{ to_lower( is_type-type_stem ) }|.
    lt_outputs = uses( it_params = lt_params is_type = is_type iv_direction = 'O' ).
    lt_inputs  = uses( it_params = lt_params is_type = is_type iv_direction = 'I' ).
    rv_text = |  method { is_op-method }.\n*-------------------------------------------------------------\n*  Data declaration\n*-------------------------------------------------------------\n|.

    CASE is_op-type.
      WHEN 'R'.
        APPEND ' DATA ls_converted_keys LIKE er_entity.' TO lt_extra.
        APPEND ' DATA lv_source_entity_set_name TYPE string.' TO lt_extra.
        rv_text = rv_text && declarations( it_params = lt_params iv_intf = lv_intf it_extra = lt_extra ).
        lv_body = |\n{ request_banner( ) }* Get key table information - for direct call\n|
          && | io_tech_request_context->get_converted_keys(\n|
          && |   IMPORTING\n|
          && |     es_key_values = ls_converted_keys ).\n|
          && constant_lines( lt_params )
          && |\n* Maps key fields to function module parameters\n\n|
          && | lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).\n|.
        LOOP AT lt_inputs INTO ls_use.
          lt_sources = source_sets( is_model = is_model is_type = is_type is_property = ls_use-property ).
          LOOP AT lt_sources INTO ls_source.
            READ TABLE lt_seen WITH KEY table_line = ls_source-set_name TRANSPORTING NO FIELDS.
            IF sy-subrc = 0.
              CONTINUE.
            ENDIF.
            APPEND ls_source-set_name TO lt_seen.
            lv_body = lv_body
              && | IF lv_source_entity_set_name = '{ ls_source-set_name }' AND\n|
              && |    lv_source_entity_set_name NE io_tech_request_context->get_entity_set_name( ).\n|
              && |   io_tech_request_context->get_converted_source_keys(\n|
              && |   IMPORTING es_key_values = ls_converted_keys ).\n|
              && | ENDIF.\n|.
          ENDLOOP.
        ENDLOOP.
        LOOP AT lt_inputs INTO ls_use.
          lv_body = lv_body && | { param_path( is_param = ls_use-param iv_component = ls_use-prop-component ) } = ls_converted_keys-{ to_lower( ls_use-property-abap_field ) }.\n|.
        ENDLOOP.
        lv_body = lv_body && append_constant_lines( lt_params ) && get_destination( ) && | lv_rfc_name = '{ is_op-function_name }'.\n|
          && |\n| && call_function( lt_params ) && |\n| && error_handling( ) && save_log( is_op-log_attr )
          && |\n*-------------------------------------------------------------------------*\n|
          && |*             - Post Backend Call -\n|
          && |*-------------------------------------------------------------------------*\n|
          && |* Map properties from the backend to the Gateway output response structure\n|
          && |\n|.
        LOOP AT lt_outputs INTO ls_use.
          IF ls_use-param-shape = 'table'.
            lv_body = lv_body && | READ TABLE { to_lower( ls_use-param-name ) } INTO ls_{ to_lower( ls_use-param-name ) } INDEX 1.\n|
              && | er_entity-{ to_lower( ls_use-property-abap_field ) } = ls_{ to_lower( ls_use-param-name ) }-{ to_lower( ls_use-prop-component ) }.\n|.
          ELSE.
            lv_body = lv_body && | er_entity-{ to_lower( ls_use-property-abap_field ) } = { param_path( is_param = ls_use-param iv_component = ls_use-prop-component ) }.\n|.
          ENDIF.
        ENDLOOP.

      WHEN 'Q'.
        LOOP AT lt_outputs INTO ls_use WHERE param-shape = 'table'.
          ls_out_table = ls_use-param.
          lv_has_out = abap_true.
          EXIT.
        ENDLOOP.
        lt_ranges = uses( it_params = lt_params is_type = is_type iv_direction = 'I' iv_ranges = abap_true ).
        LOOP AT lt_inputs INTO ls_use.
          lt_sources = source_sets( is_model = is_model is_type = is_type is_property = ls_use-property ).
          LOOP AT lt_sources INTO ls_source.
            ls_source-use = ls_use.
            APPEND ls_source TO lt_nav.
          ENDLOOP.
        ENDLOOP.
* the variable that holds the source keys is named like an operation
* method: 16 characters of the entity + _get_entityset
        LOOP AT lt_nav INTO ls_source.
          READ TABLE lt_vars WITH KEY name = ls_source-entity-name TRANSPORTING NO FIELDS.
          IF sy-subrc <> 0.
            APPEND ls_source-entity TO lt_vars.
          ENDIF.
        ENDLOOP.
        lt_filtered = lt_inputs.
        APPEND LINES OF lt_ranges TO lt_filtered.
        APPEND ' DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.' TO lt_extra.
        APPEND ' DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.' TO lt_extra.
        APPEND ' DATA lv_filter_str TYPE string.' TO lt_extra.
        APPEND ' DATA ls_paging TYPE /iwbep/s_mgw_paging.' TO lt_extra.
        APPEND ' DATA ls_converted_keys LIKE LINE OF et_entityset.' TO lt_extra.
        IF lt_nav IS NOT INITIAL.
          APPEND ' DATA lv_source_entity_set_name TYPE string.' TO lt_extra.
        ENDIF.
        LOOP AT lt_vars INTO ls_var.
          lv_var = to_lower( ls_var-tech_name ).
          IF strlen( lv_var ) > 16.
            lv_var = substring( val = lv_var len = 16 ).
          ENDIF.
          APPEND | DATA { lv_var }_get_entityset TYPE LINE OF { lv_mpc }=>tt_{ to_lower( ls_var-type_stem ) }.| TO lt_extra.
        ENDLOOP.
        APPEND ' DATA ls_filter TYPE /iwbep/s_mgw_select_option.' TO lt_extra.
        APPEND ' DATA ls_filter_range TYPE /iwbep/s_cod_select_option.' TO lt_extra.
        LOOP AT lt_filtered INTO ls_use.
          lv_f = to_lower( ls_use-property-abap_field ).
          APPEND | DATA lr_{ lv_f } LIKE RANGE OF ls_converted_keys-{ lv_f }.\n DATA ls_{ lv_f } LIKE LINE OF lr_{ lv_f }.| TO lt_extra.
        ENDLOOP.
        IF lv_has_out = abap_true.
          APPEND | DATA ls_gw_{ to_lower( ls_out_table-name ) } LIKE LINE OF et_entityset.| TO lt_extra.
        ENDIF.
        APPEND ' DATA lv_skip     TYPE int4.' TO lt_extra.
        APPEND ' DATA lv_top      TYPE int4.' TO lt_extra.
        rv_text = rv_text && declarations( it_params = lt_params iv_intf = lv_intf it_extra = lt_extra ).
        lv_body = |\n{ request_banner( ) }* Get filter or select option information\n|
          && | lo_filter = io_tech_request_context->get_filter( ).\n|
          && | lt_filter_select_options = lo_filter->get_filter_select_options( ).\n|
          && | lv_filter_str = lo_filter->get_filter_string( ).\n|
          && |\n|
          && |* Check if the supplied filter is supported by standard gateway runtime process\n|
          && | IF  lv_filter_str            IS NOT INITIAL\n|
          && | AND lt_filter_select_options IS INITIAL.\n|
          && |   " If the string of the Filter System Query Option is not automatically converted into\n|
          && |   " filter option table (lt_filter_select_options), then the filtering combination is not supported\n|
          && |   " Log message in the application log\n|
          && |   me->/iwbep/if_sb_dpc_comm_services~log_message(\n|
          && |     EXPORTING\n|
          && |       iv_msg_type   = 'E'\n|
          && |       iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'\n|
          && |       iv_msg_number = 025 ).\n|
          && |   " Raise Exception\n|
          && |   RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception\n|
          && |     EXPORTING\n|
          && |       textid = /iwbep/cx_mgw_tech_exception=>internal_error.\n|
          && | ENDIF.\n|
          && |\n|
          && |* Get key table information\n|
          && | io_tech_request_context->get_converted_source_keys(\n|
          && |   IMPORTING\n|
          && |     es_key_values  = ls_converted_keys ).\n|
          && |\n|
          && | ls_paging-top = io_tech_request_context->get_top( ).\n|
          && | ls_paging-skip = io_tech_request_context->get_skip( ).\n|
          && constant_lines( lt_params ).
        IF lt_nav IS NOT INITIAL.
          lv_body = lv_body && |\n* Maps key fields to function module parameters\n IF it_key_tab IS NOT INITIAL.\n   lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).\n|.
          LOOP AT lt_nav INTO ls_source.
            lv_var = to_lower( ls_source-entity-tech_name ).
            IF strlen( lv_var ) > 16.
              lv_var = substring( val = lv_var len = 16 ).
            ENDIF.
            lv_body = lv_body
              && |   IF  lv_source_entity_set_name = '{ ls_source-set_name }'.\n|
              && |     " Convert keys to appropriate entity set structure\n|
              && |     io_tech_request_context->get_converted_source_keys(\n|
              && |       IMPORTING\n|
              && |         es_key_values  = { lv_var }_get_entityset ).\n|
              && |     { param_path( is_param = ls_source-use-param iv_component = ls_source-use-prop-component ) } = { lv_var }_get_entityset-{ to_lower( ls_source-field ) }.\n|
              && |   ENDIF.\n|.
          ENDLOOP.
          lv_body = lv_body && | ENDIF.\n|.
        ENDIF.
        IF lt_filtered IS NOT INITIAL.
          lv_body = lv_body && |\n IF it_filter_select_options IS NOT INITIAL.\n* Maps filter table lines to function module parameters\n   LOOP AT lt_filter_select_options INTO ls_filter.\n\n     LOOP AT ls_filter-select_options INTO ls_filter_range.\n       CASE ls_filter-property.\n|.
          LOOP AT lt_filtered INTO ls_use.
            lv_f = to_lower( ls_use-property-abap_field ).
            lv_body = lv_body
              && |         WHEN '{ to_upper( ls_use-property-abap_field ) }'.              " Equivalent to '{ ls_use-prop-property }' property in the service\n|
              && |           lo_filter->convert_select_option(\n|
              && |             EXPORTING\n|
              && |               is_select_option = ls_filter\n|
              && |             IMPORTING\n|
              && |               et_select_option = lr_{ lv_f } ).\n|.
            IF ls_use-prop-ranges IS NOT INITIAL.
* the components by semantics: H, L, O, S
              lt_comps = ls_use-prop-ranges.
              lv_i = 1.
              WHILE lv_i < lines( lt_comps ).
                lv_j = lv_i + 1.
                WHILE lv_j <= lines( lt_comps ).
                  READ TABLE lt_comps INDEX lv_i INTO ls_range.
                  READ TABLE lt_comps INDEX lv_j INTO ls_swap.
                  IF ls_swap-semantics < ls_range-semantics.
                    MODIFY lt_comps INDEX lv_i FROM ls_swap.
                    MODIFY lt_comps INDEX lv_j FROM ls_range.
                  ENDIF.
                  lv_j = lv_j + 1.
                ENDWHILE.
                lv_i = lv_i + 1.
              ENDWHILE.
              lv_body = lv_body && |           LOOP AT lr_{ lv_f } INTO ls_{ lv_f }.\n|.
              LOOP AT lt_comps INTO ls_range.
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
                lv_body = lv_body && |             ls_{ to_lower( ls_use-param-name ) }-{ to_lower( ls_range-component ) } = ls_{ lv_f }-{ lv_sem }.\n|.
              ENDLOOP.
              lv_body = lv_body && |             APPEND ls_{ to_lower( ls_use-param-name ) } TO { to_lower( ls_use-param-name ) }.\n           ENDLOOP.\n|.
            ELSE.
              lv_body = lv_body && |           READ TABLE lr_{ lv_f } INTO ls_{ lv_f } INDEX 1.\n           IF sy-subrc = 0.\n             { param_path( is_param = ls_use-param iv_component = ls_use-prop-component ) } = ls_{ lv_f }-low.\n           ENDIF.\n|.
            ENDIF.
          ENDLOOP.
          lv_body = lv_body
            && |         WHEN OTHERS.\n|
            && |           " Log message in the application log\n|
            && |           me->/iwbep/if_sb_dpc_comm_services~log_message(\n|
            && |             EXPORTING\n|
            && |               iv_msg_type   = 'E'\n|
            && |               iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'\n|
            && |               iv_msg_number = 020\n|
            && |               iv_msg_v1     = ls_filter-property ).\n|
            && |           " Raise Exception\n|
            && |           RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception\n|
            && |             EXPORTING\n|
            && |               textid = /iwbep/cx_mgw_tech_exception=>internal_error.\n|
            && |       ENDCASE.\n|
            && |     ENDLOOP.\n|
            && |\n|
            && |   ENDLOOP.\n|
            && | ENDIF.\n|.
        ENDIF.
        lv_body = lv_body && append_constant_lines( lt_params ) && get_destination( ) && | lv_rfc_name = '{ is_op-function_name }'.\n|
          && |\n| && call_function( lt_params ) && |\n| && error_handling( ) && save_log( is_op-log_attr )
          && |\n*-------------------------------------------------------------------------*\n|
          && |*             - Post Backend Call -\n|
          && |*-------------------------------------------------------------------------*\n|.
        IF lv_has_out = abap_true.
          lv_body = lv_body
            && | IF ls_paging-skip IS NOT INITIAL.\n|
            && |*  If the Skip value was requested at runtime\n|
            && |*  the response table will provide backend entries from skip + 1, meaning start from skip +1\n|
            && |*  for example: skip=5 means to start get results from the 6th row\n|
            && |   lv_skip = ls_paging-skip + 1.\n|
            && | ENDIF.\n|
            && |*  The Top value was requested at runtime but was not handled as part of the function interface\n|
            && | IF  ls_paging-top <> 0\n|
            && | AND lv_skip IS NOT INITIAL.\n|
            && |*  if lv_skip > 0 retrieve the entries from lv_skip + Top - 1\n|
            && |*  for example: skip=5 and top=2 means to start get results from the 6th row and end in row number 7\n|
            && |   lv_top = ls_paging-top + lv_skip - 1.\n|
            && | ELSEIF ls_paging-top <> 0\n|
            && | AND    lv_skip IS INITIAL.\n|
            && |   lv_top = ls_paging-top.\n|
            && | ELSE.\n|
            && |   lv_top = LINES( { to_lower( ls_out_table-name ) } ).\n|
            && | ENDIF.\n|
            && |\n|
            && |*  - Map properties from the backend to the Gateway output response table -\n|
            && |\n|
            && | LOOP AT { to_lower( ls_out_table-name ) } INTO ls_{ to_lower( ls_out_table-name ) }\n|
            && |*  Provide the response entries according to the Top and Skip parameters that were provided at runtime\n|
            && |      FROM lv_skip TO lv_top.\n|
            && |*  Only fields that were mapped will be delivered to the response table\n|.
          LOOP AT lt_outputs INTO ls_use WHERE param-name = ls_out_table-name.
            lv_body = lv_body && |   ls_gw_{ to_lower( ls_out_table-name ) }-{ to_lower( ls_use-property-abap_field ) } = ls_{ to_lower( ls_out_table-name ) }-{ to_lower( ls_use-prop-component ) }.\n|.
          ENDLOOP.
          lv_body = lv_body
            && |   APPEND ls_gw_{ to_lower( ls_out_table-name ) } TO et_entityset.\n|
            && |   CLEAR ls_gw_{ to_lower( ls_out_table-name ) }.\n|
            && | ENDLOOP.\n|.
        ENDIF.

      WHEN 'C'.
        APPEND | DATA ls_request_input_data TYPE { lv_ts }.| TO lt_extra.
        APPEND ' DATA ls_entity TYPE REF TO data.' TO lt_extra.
        APPEND ' DATA lo_tech_read_request_context TYPE REF TO /iwbep/cl_sb_gen_read_aftr_crt.' TO lt_extra.
        APPEND ' DATA ls_key TYPE /iwbep/s_mgw_tech_pair.' TO lt_extra.
        APPEND ' DATA lt_keys TYPE /iwbep/t_mgw_tech_pairs.' TO lt_extra.
        APPEND ' DATA lv_entityset_name TYPE string.' TO lt_extra.
        APPEND ' DATA lv_entity_name TYPE string.' TO lt_extra.
        APPEND ' FIELD-SYMBOLS: <ls_data> TYPE ANY.' TO lt_extra.
        APPEND ' DATA ls_converted_keys LIKE er_entity.' TO lt_extra.
        rv_text = rv_text && declarations( it_params = lt_params iv_intf = lv_intf it_extra = lt_extra ).
        lv_body = |\n{ request_banner( ) }* Get request input data\n|
          && | io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).\n|
          && constant_lines( lt_params )
          && |\n* Map request input fields to function module parameters\n|
          && input_lines( it_params = lt_params is_type = is_type iv_keys_too = abap_true )
          && append_constant_lines( lt_params ) && get_destination( ) && | lv_rfc_name = '{ is_op-function_name }'.\n|
          && |\n| && call_function( lt_params ) && |\n| && error_handling( ) && save_log( is_op-log_attr ) && commit( )
          && |*-------------------------------------------------------------------------*\n|
          && |*             - Read After Create -\n|
          && |*-------------------------------------------------------------------------*\n|
          && | CREATE OBJECT lo_tech_read_request_context.\n|
          && |\n|
          && |* Create key table for the read operation\n|
          && |\n|.
        LOOP AT is_type-properties INTO ls_property WHERE is_key = abap_true.
          lv_found = abap_false.
          LOOP AT lt_outputs INTO ls_use WHERE prop-property = ls_property-name.
            lv_found = abap_true.
            EXIT.
          ENDLOOP.
          IF lv_found = abap_true.
            IF ls_use-param-shape = 'table'.
              lv_value = |ls_{ to_lower( ls_use-param-name ) }-{ to_lower( ls_use-prop-component ) }|.
            ELSE.
              lv_value = param_path( is_param = ls_use-param iv_component = ls_use-prop-component ).
            ENDIF.
          ELSE.
            lv_value = |ls_request_input_data-{ to_lower( ls_property-abap_field ) }|.
          ENDIF.
          lv_body = lv_body
            && | ls_key-name = '{ to_upper( ls_property-abap_field ) }'.\n|
            && | ls_key-value = { lv_value }.\n|
            && | IF ls_key-value IS NOT INITIAL.\n|
            && |   APPEND ls_key TO lt_keys.\n|
            && | ENDIF.\n|
            && |\n|.
        ENDLOOP.
        lv_body = lv_body
          && |* Set into request context object the key table and the entity set name\n|
          && | lo_tech_read_request_context->set_keys( EXPORTING  it_keys = lt_keys ).\n|
          && | lv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && | lo_tech_read_request_context->set_entityset_name( EXPORTING iv_entityset_name = lv_entityset_name ).\n|
          && | lv_entity_name = io_tech_request_context->get_entity_type_name( ).\n|
          && | lo_tech_read_request_context->set_entity_type_name( EXPORTING iv_entity_name = lv_entity_name ).\n|
          && |\n|
          && |* Call read after create\n|
          && | /iwbep/if_mgw_appl_srv_runtime~get_entity(\n|
          && |   EXPORTING\n|
          && |     iv_entity_name     = iv_entity_name\n|
          && |     iv_entity_set_name = iv_entity_set_name\n|
          && |     iv_source_name     = iv_source_name\n|
          && |     it_key_tab         = it_key_tab\n|
          && |     io_tech_request_context = lo_tech_read_request_context\n|
          && |     it_navigation_path = it_navigation_path\n|
          && |   IMPORTING\n|
          && |     er_entity          = ls_entity ).\n|
          && |\n|
          && |* Send the read response to the caller interface\n|
          && | ASSIGN ls_entity->* TO <ls_data>.\n|
          && | er_entity = <ls_data>.\n|.

      WHEN 'U'.
        APPEND | DATA ls_request_input_data TYPE { lv_ts }.| TO lt_extra.
        APPEND ' DATA ls_converted_keys LIKE er_entity.' TO lt_extra.
        APPEND ' DATA lv_source_entity_set_name TYPE string.' TO lt_extra.
        rv_text = rv_text && declarations( it_params = lt_params iv_intf = lv_intf it_extra = lt_extra ).
        lv_body = |\n{ request_banner( ) }* Get request input data\n|
          && | io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).\n|
          && |* Get key table information\n|
          && | io_tech_request_context->get_converted_keys(\n|
          && |   IMPORTING\n|
          && |     es_key_values  = ls_converted_keys ).\n|
          && constant_lines( lt_params )
          && |\n* Maps key fields to function module parameters\n\n|
          && key_lines( it_params = lt_params is_type = is_type iv_source = 'ls_converted_keys' )
          && |* Map request input fields to function module parameters\n|
          && input_lines( it_params = lt_params is_type = is_type iv_keys_too = abap_false )
          && append_constant_lines( lt_params ) && get_destination( ) && | lv_rfc_name = '{ is_op-function_name }'.\n|
          && |\n| && call_function( lt_params ) && |\n| && error_handling( ) && save_log( is_op-log_attr ) && commit( ).

      WHEN 'D'.
        APPEND | DATA ls_converted_keys TYPE { lv_ts }.| TO lt_extra.
        APPEND ' DATA lv_source_entity_set_name TYPE string.' TO lt_extra.
        rv_text = rv_text && declarations( it_params = lt_params iv_intf = lv_intf it_extra = lt_extra ).
        lv_body = |\n{ request_banner( ) }* Get key table information\n|
          && | io_tech_request_context->get_converted_keys(\n|
          && |   IMPORTING\n|
          && |     es_key_values  = ls_converted_keys ).\n|
          && constant_lines( lt_params )
          && |\n* Maps key fields to function module parameters\n\n|
          && key_lines( it_params = lt_params is_type = is_type iv_source = 'ls_converted_keys' )
          && append_constant_lines( lt_params ) && get_destination( ) && | lv_rfc_name = '{ is_op-function_name }'.\n|
          && |\n| && call_function( lt_params ) && |\n| && error_handling( ) && save_log( is_op-log_attr ) && commit( ).

      WHEN OTHERS.
        CLEAR rv_text.
        RETURN.
    ENDCASE.
    rv_text = rv_text && lv_body && |  endmethod.\n|.
  ENDMETHOD.

* ---------------------------------------------------------- search help

  METHOD shlp_implementation.
    rv_text = |  method /IWBEP/IF_SB_GENDPC_SHLP_DATA~GET_SEARCH_HELP_VALUES.\n|
      && |* Call to Search Help run time mechanism to get values\n|
      && |  DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.\n|
      && |\n|
      && |  CLEAR: et_return_list, es_message.\n|
      && |  lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).\n|
      && |\n|
      && |  lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(\n|
      && |    EXPORTING\n|
      && |      iv_shlp_name  = iv_shlp_name\n|
      && |      iv_maxrows  = iv_maxrows\n|
      && |      iv_sort = iv_sort\n|
      && |      iv_call_shlt_exit = iv_call_shlt_exit\n|
      && |      it_selopt = it_selopt\n|
      && |    IMPORTING\n|
      && |      et_return_list = et_return_list\n|
      && |      es_message = es_message ).\n|
      && |  endmethod.\n|.
  ENDMETHOD.

  METHOD shlp_result_case.
    DATA ls_use TYPE ty_use.

    LOOP AT it_outputs INTO ls_use.
      rv_text = rv_text && |    WHEN '{ to_upper( ls_use-prop-component ) }'.\n      { iv_target }-{ to_lower( ls_use-property-abap_field ) } = ls_result_list-field_value.\n|.
    ENDLOOP.
  ENDMETHOD.

  METHOD shlp_method.
    DATA ls_mp       TYPE zcl_stg_segw_gen=>ty_map_prop.
    DATA lt_inputs   TYPE tt_use.
    DATA lt_outputs  TYPE tt_use.
    DATA ls_use      TYPE ty_use.
    DATA lv_found    TYPE abap_bool.
    DATA lv_shlp     TYPE string.
    DATA lv_f        TYPE string.
    DATA lv_first    TYPE abap_bool.

    lv_shlp = is_op-function_name.
* inputs with their property (the key or the filter property), outputs with
* the search help field they come from
    LOOP AT is_op-props INTO ls_mp.
      CLEAR ls_use.
      ls_use-prop-property  = ls_mp-property.
      ls_use-prop-direction = ls_mp-direction.
      ls_use-prop-uuid      = ls_mp-uuid.
      ls_use-prop-component = zcl_stg_segw_gen=>last_segment( ls_mp-ds_att_path ).
      ls_use-param-name     = ls_mp-ds_att_path.
      IF ls_mp-direction = 'I'.
        ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_mp-property IMPORTING ev_found = lv_found ).
        IF lv_found = abap_true.
          APPEND ls_use TO lt_inputs.
        ENDIF.
      ELSEIF ls_mp-direction = 'O'.
        ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_mp-property IMPORTING ev_found = lv_found ).
        IF lv_found = abap_true.
          APPEND ls_use TO lt_outputs.
        ENDIF.
      ENDIF.
    ENDLOOP.

    IF is_op-type = 'Q'.
      rv_text = |  method { is_op-method }.\n|
        && |*-------------------------------------------------------------\n|
        && |*  Data declaration\n|
        && |*-------------------------------------------------------------\n|
        && |DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.\n|
        && |DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.\n|
        && |DATA lv_filter_str TYPE string.\n|
        && |DATA lv_max_hits TYPE i.\n|
        && |DATA ls_paging TYPE /iwbep/s_mgw_paging.\n|
        && |DATA ls_converted_keys LIKE LINE OF et_entityset.\n|
        && |DATA ls_message TYPE bapiret2.\n|
        && |DATA lt_selopt TYPE ddshselops.\n|
        && |DATA ls_selopt LIKE LINE OF lt_selopt.\n|.
      IF lt_inputs IS NOT INITIAL.
        rv_text = rv_text && |DATA ls_filter TYPE /iwbep/s_mgw_select_option.\nDATA ls_filter_range TYPE /iwbep/s_cod_select_option.\n|.
      ENDIF.
      LOOP AT lt_inputs INTO ls_use.
        lv_f = to_lower( ls_use-property-abap_field ).
        rv_text = rv_text && |DATA lr_{ lv_f } LIKE RANGE OF ls_converted_keys-{ lv_f }.\nDATA ls_{ lv_f } LIKE LINE OF lr_{ lv_f }.\n|.
      ENDLOOP.
      rv_text = rv_text
        && |DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.\n|
        && |DATA lv_next TYPE i VALUE 1.\n|
        && |DATA ls_entityset LIKE LINE OF et_entityset.\n|
        && |DATA ls_result_list_next LIKE LINE OF lt_result_list.\n|
        && |DATA ls_result_list LIKE LINE OF lt_result_list.\n|
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Map the runtime request to the Search Help select option - Only mapped attributes\n|
        && |*-------------------------------------------------------------\n|
        && |* Get all input information from the technical request context object\n|
        && |* Since DPC works with internal property names and runtime API interface holds external property names\n|
        && |* the process needs to get the all needed input information from the technical request context object\n|
        && |* Get filter or select option information\n|
        && |lo_filter = io_tech_request_context->get_filter( ).\n|
        && |lt_filter_select_options = lo_filter->get_filter_select_options( ).\n|
        && |lv_filter_str = lo_filter->get_filter_string( ).\n|
        && |\n|
        && |* Check if the supplied filter is supported by standard gateway runtime process\n|
        && |IF  lv_filter_str            IS NOT INITIAL\n|
        && |AND lt_filter_select_options IS INITIAL.\n|
        && |  " If the string of the Filter System Query Option is not automatically converted into\n|
        && |  " filter option table (lt_filter_select_options), then the filtering combination is not supported\n|
        && |  " Log message in the application log\n|
        && |  me->/iwbep/if_sb_dpc_comm_services~log_message(\n|
        && |    EXPORTING\n|
        && |      iv_msg_type   = 'E'\n|
        && |      iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'\n|
        && |      iv_msg_number = 025 ).\n|
        && |  " Raise Exception\n|
        && |  RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception\n|
        && |    EXPORTING\n|
        && |      textid = /iwbep/cx_mgw_tech_exception=>internal_error.\n|
        && |ENDIF.\n|
        && |\n|
        && |* Get key table information\n|
        && |io_tech_request_context->get_converted_source_keys(\n|
        && |  IMPORTING\n|
        && |    es_key_values  = ls_converted_keys ).\n|
        && |\n|
        && |ls_paging-top = io_tech_request_context->get_top( ).\n|
        && |ls_paging-skip = io_tech_request_context->get_skip( ).\n|
        && |\n|
        && |" Calculate the number of max hits to be fetched from the function module\n|
        && |" The lv_max_hits value is a summary of the Top and Skip values\n|
        && |IF ls_paging-top > 0.\n|
        && |  lv_max_hits = is_paging-top + is_paging-skip.\n|
        && |ENDIF.\n|
        && |\n|.
      IF lt_inputs IS NOT INITIAL.
        rv_text = rv_text
          && |* Maps filter table lines to the Search Help select option table\n|
          && |LOOP AT lt_filter_select_options INTO ls_filter.\n|
          && |\n|
          && |  CASE ls_filter-property.\n|.
        LOOP AT lt_inputs INTO ls_use.
          lv_f = to_lower( ls_use-property-abap_field ).
          rv_text = rv_text
            && |    WHEN '{ to_upper( ls_use-property-abap_field ) }'.              " Equivalent to '{ ls_use-prop-property }' property in the service\n|
            && |      lo_filter->convert_select_option(\n|
            && |        EXPORTING\n|
            && |          is_select_option = ls_filter\n|
            && |        IMPORTING\n|
            && |          et_select_option = lr_{ lv_f } ).\n|
            && |\n|
            && |      LOOP AT lr_{ lv_f } INTO ls_{ lv_f }.\n|
            && |        ls_selopt-high = ls_{ lv_f }-high.\n|
            && |        ls_selopt-low = ls_{ lv_f }-low.\n|
            && |        ls_selopt-option = ls_{ lv_f }-option.\n|
            && |        ls_selopt-sign = ls_{ lv_f }-sign.\n|
            && |        ls_selopt-shlpfield = '{ to_upper( ls_use-param-name ) }'.\n|
            && |        ls_selopt-shlpname = '{ lv_shlp }'.\n|
            && |        APPEND ls_selopt TO lt_selopt.\n|
            && |        CLEAR ls_selopt.\n|
            && |      ENDLOOP.\n|.
        ENDLOOP.
        rv_text = rv_text
          && |\n|
          && |    WHEN OTHERS.\n|
          && |      " Log message in the application log\n|
          && |      me->/iwbep/if_sb_dpc_comm_services~log_message(\n|
          && |        EXPORTING\n|
          && |          iv_msg_type   = 'E'\n|
          && |          iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'\n|
          && |          iv_msg_number = 020\n|
          && |          iv_msg_v1     = ls_filter-property ).\n|
          && |      " Raise Exception\n|
          && |      RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception\n|
          && |        EXPORTING\n|
          && |          textid = /iwbep/cx_mgw_tech_exception=>internal_error.\n|
          && |  ENDCASE.\n|
          && |ENDLOOP.\n|.
      ENDIF.
      rv_text = rv_text
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Call to Search Help get values mechanism\n|
        && |*-------------------------------------------------------------\n|
        && |* Get search help values\n|
        && |me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(\n|
        && |  EXPORTING\n|
        && |    iv_shlp_name = '{ lv_shlp }'\n|
        && |    iv_maxrows = lv_max_hits\n|
        && |    iv_sort = 'X'\n|
        && |    iv_call_shlt_exit = 'X'\n|
        && |    it_selopt = lt_selopt\n|
        && |  IMPORTING\n|
        && |    et_return_list = lt_result_list\n|
        && |    es_message = ls_message ).\n|
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Map the Search Help returned results to the caller interface - Only mapped attributes\n|
        && |*-------------------------------------------------------------\n|
        && |IF ls_message IS NOT INITIAL.\n|
        && |* Call RFC call exception handling\n|
        && |  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(\n|
        && |    EXPORTING\n|
        && |      is_return      = ls_message\n|
        && |      iv_entity_type = iv_entity_name\n|
        && |      it_key_tab     = it_key_tab ).\n|
        && |ENDIF.\n|
        && |\n|
        && |CLEAR et_entityset.\n|
        && |\n|
        && |LOOP AT lt_result_list INTO ls_result_list\n|
        && |  WHERE record_number > ls_paging-skip.\n|
        && |\n|
        && |  " Move SH results to GW request responce table\n|
        && |  lv_next = sy-tabix + 1. " next loop iteration\n|
        && |  CASE ls_result_list-field_name.\n|
        && shlp_result_case( it_outputs = lt_outputs iv_target = 'ls_entityset' )
        && |  ENDCASE.\n|
        && |\n|
        && |  " Check if the next line in the result list is a new record\n|
        && |  READ TABLE lt_result_list INTO ls_result_list_next INDEX lv_next.\n|
        && |  IF sy-subrc <> 0\n|
        && |  OR ls_result_list-record_number <> ls_result_list_next-record_number.\n|
        && |    " Save the collected SH result in the GW request table\n|
        && |    APPEND ls_entityset TO et_entityset.\n|
        && |    CLEAR: ls_result_list_next, ls_entityset.\n|
        && |  ENDIF.\n|
        && |\n|
        && |ENDLOOP.\n|
        && |\n|
        && |  endmethod.\n|.
      RETURN.
    ENDIF.

    IF is_op-type = 'R'.
      rv_text = |  method { is_op-method }.\n|
        && |*-------------------------------------------------------------\n|
        && |*  Data declaration\n|
        && |*-------------------------------------------------------------\n|
        && |DATA lv_max_hits TYPE i VALUE 1.\n|
        && |DATA ls_converted_keys LIKE er_entity.\n|
        && |DATA ls_message TYPE bapiret2.\n|
        && |DATA lt_selopt TYPE ddshselops.\n|
        && |DATA ls_selopt LIKE LINE OF lt_selopt.\n|
        && |DATA lv_source_entity_set_name TYPE string.\n|
        && |DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.\n|
        && |DATA ls_result_list LIKE LINE OF lt_result_list.\n|
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Map the runtime request to the Search Help select option - Only mapped attributes\n|
        && |*-------------------------------------------------------------\n|
        && |* Get all input information from the technical request context object\n|
        && |* Since DPC works with internal property names and runtime API interface holds external property names\n|
        && |* the process needs to get the all needed input information from the technical request context object\n|
        && |* Get key table information - for direct call\n|
        && |io_tech_request_context->get_converted_keys(\n|
        && |  IMPORTING\n|
        && |    es_key_values = ls_converted_keys ).\n|
        && |\n|
        && |* Maps key fields to function module parameters\n|
        && |\n|
        && |lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).\n|
        && |\n|.
      lv_first = abap_true.
      LOOP AT lt_inputs INTO ls_use.
        IF lv_first = abap_false.
          rv_text = rv_text && |\n|.
        ENDIF.
        lv_first = abap_false.
        rv_text = rv_text
          && |ls_selopt-sign = 'I'.\n|
          && |ls_selopt-option = 'EQ'.\n|
          && |ls_selopt-low = ls_converted_keys-{ to_lower( ls_use-property-abap_field ) }.\n|
          && |ls_selopt-shlpfield = '{ to_upper( ls_use-param-name ) }'.\n|
          && |ls_selopt-shlpname = '{ lv_shlp }'.\n|
          && |APPEND ls_selopt TO lt_selopt.\n|
          && |CLEAR ls_selopt.\n|.
      ENDLOOP.
      rv_text = rv_text
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Call to Search Help get values mechanism\n|
        && |*-------------------------------------------------------------\n|
        && |* Get search help values\n|
        && |me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(\n|
        && |  EXPORTING\n|
        && |    iv_shlp_name = '{ lv_shlp }'\n|
        && |    iv_maxrows = lv_max_hits\n|
        && |    iv_sort = 'X'\n|
        && |    iv_call_shlt_exit = 'X'\n|
        && |    it_selopt = lt_selopt\n|
        && |  IMPORTING\n|
        && |    et_return_list = lt_result_list\n|
        && |    es_message = ls_message ).\n|
        && |\n|
        && |*-------------------------------------------------------------\n|
        && |*  Map the Search Help returned results to the caller interface - Only mapped attributes\n|
        && |*-------------------------------------------------------------\n|
        && |IF ls_message IS NOT INITIAL.\n|
        && |* Call RFC call exception handling\n|
        && |  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(\n|
        && |    EXPORTING\n|
        && |      is_return      = ls_message\n|
        && |      iv_entity_type = iv_entity_name\n|
        && |      it_key_tab     = it_key_tab ).\n|
        && |ENDIF.\n|
        && |\n|
        && |CLEAR er_entity.\n|
        && |LOOP AT lt_result_list INTO ls_result_list.\n|
        && |\n|
        && |  " Move SH results to GW request responce table\n|
        && |  CASE ls_result_list-field_name.\n|
        && shlp_result_case( it_outputs = lt_outputs iv_target = 'er_entity' )
        && |  ENDCASE.\n|
        && |\n|
        && |ENDLOOP.\n|
        && |\n|
        && |  endmethod.\n|.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
