CLASS zcl_osd_dsl_dpc_templates DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get IMPORTING iv_name TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS names RETURNING VALUE(rt_names) TYPE string_table.
ENDCLASS.

CLASS zcl_osd_dsl_dpc_templates IMPLEMENTATION.
  METHOD get.
    CASE iv_name.
      WHEN 'class'.
        rv_text = ``
      && `{{! SEGW keeps redefinitions in Q R U C D order, then sorts implementation names. }}`
      && cl_abap_char_utilities=>newline
      && `class {{dpc}} definition`
      && cl_abap_char_utilities=>newline
      && `  public`
      && cl_abap_char_utilities=>newline
      && `  inheriting from /IWBEP/CL_MGW_PUSH_ABS_DATA`
      && cl_abap_char_utilities=>newline
      && `  abstract`
      && cl_abap_char_utilities=>newline
      && `  create public .`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `public section.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  interfaces /IWBEP/IF_SB_DPC_COMM_SERVICES .`
      && cl_abap_char_utilities=>newline
      && `{{#has_shlp}}  interfaces /IWBEP/IF_SB_GENDPC_SHLP_DATA .`
      && cl_abap_char_utilities=>newline
      && `{{/has_shlp}}  interfaces /IWBEP/IF_SB_GEN_DPC_INJECTION .`
      && cl_abap_char_utilities=>newline
      && `{{#has_sadl}}  interfaces IF_SADL_GW_DPC_UTIL .`
      && cl_abap_char_utilities=>newline
      && `  interfaces IF_SADL_GW_EXTENSION_CONTROL .`
      && cl_abap_char_utilities=>newline
      && `  interfaces IF_SADL_GW_QUERY_CONTROL .`
      && cl_abap_char_utilities=>newline
      && `{{/has_sadl}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#redefs}}  methods /IWBEP/IF_MGW_APPL_SRV_RUNTIME~{{name}}`
      && cl_abap_char_utilities=>newline
      && `    redefinition .`
      && cl_abap_char_utilities=>newline
      && `{{/redefs}}protected section.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  data mo_injection type ref to /IWBEP/IF_SB_GEN_DPC_INJECTION .`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#declarations}}`
      && cl_abap_char_utilities=>newline
      && `{{#is_c}}{{> signature_c}}{{/is_c}}{{#is_d}}{{> signature_d}}{{/is_d}}{{#is_r}}{{> signature_r}}{{/is_r}}{{#is_q}}{{> signature_q}}{{/is_q}}{{#is_u}}{{> signature_u}}{{/i`
      && `s_u}}{{/declarations}}`
      && cl_abap_char_utilities=>newline
      && `  methods CHECK_SUBSCRIPTION_AUTHORITY`
      && cl_abap_char_utilities=>newline
      && `    redefinition .`
      && cl_abap_char_utilities=>newline
      && `private section.`
      && cl_abap_char_utilities=>newline
      && `ENDCLASS.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CLASS {{dpc}} IMPLEMENTATION.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{! The model's separator gives one newline before the first body and two between bodies. }}`
      && cl_abap_char_utilities=>newline
      && `{{#impls}}{{separator}}{{#dispatch_c}}{{> dispatch_c}}{{/dispatch_c}}{{#dispatch_d}}{{> dispatch_d}}{{/dispatch_d}}{{#dispatch_r}}{{> dispatch_r}}{{/dispatch_r}}{{#dispat`
      && `ch_q}}{{> dispatch_q}}{{/dispatch_q}}{{#dispatch_u}}{{> dispatch_u}}{{/dispatch_u}}{{#fixed_commit_work}}{{> fixed_commit_work}}{{/fixed_commit_work}}{{#fixed_get_generat`
      && `ion_strategy}}{{> fixed_get_generation_strategy}}{{/fixed_get_generation_strategy}}{{#fixed_log_message}}{{> fixed_log_message}}{{/fixed_log_message}}{{#fixed_rfc_excepti`
      && `on_handling}}{{> fixed_rfc_exception_handling}}{{/fixed_rfc_exception_handling}}{{#fixed_rfc_save_log}}{{> fixed_rfc_save_log}}{{/fixed_rfc_save_log}}{{#fixed_set_injecti`
      && `on}}{{> fixed_set_injection}}{{/fixed_set_injection}}{{#fixed_check_subscription_authority}}{{> fixed_check_subscription_authority}}{{/fixed_check_subscription_authority}`
      && `}{{#stub}}{{> stub}}{{/stub}}{{#odc_q}}{{> odc_q}}{{/odc_q}}{{#odc_r}}{{> odc_r}}{{/odc_r}}{{#delegate_c}}{{> delegate_c}}{{/delegate_c}}{{#delegate_d}}{{> delegate_d}}{{`
      && `/delegate_d}}{{#delegate_r}}{{> delegate_r}}{{/delegate_r}}{{#delegate_q}}{{> delegate_q}}{{/delegate_q}}{{#delegate_u}}{{> delegate_u}}{{/delegate_u}}{{#sadl_create_deep`
      && `_entity}}{{> sadl_create_deep_entity}}{{/sadl_create_deep_entity}}{{#sadl_execute_action}}{{> sadl_execute_action}}{{/sadl_execute_action}}{{#sadl_get_is_conditional_impl`
      && `emented}}{{> sadl_get_is_conditional_implemented}}{{/sadl_get_is_conditional_implemented}}{{#sadl_get_is_condi_imple_for_action}}{{> sadl_get_is_condi_imple_for_action}}{`
      && `{/sadl_get_is_condi_imple_for_action}}{{#sadl_patch_entity}}{{> sadl_patch_entity}}{{/sadl_patch_entity}}{{#sadl_get_dpc}}{{> sadl_get_dpc}}{{/sadl_get_dpc}}{{#sadl_set_e`
      && `xtension_mapping}}{{> sadl_set_extension_mapping}}{{/sadl_set_extension_mapping}}{{#sadl_set_query_options}}{{> sadl_set_query_options}}{{/sadl_set_query_options}}{{#opaq`
      && `ue}}{{{opaque}}}{{/opaque}}{{/impls}}ENDCLASS.`
      && cl_abap_char_utilities=>newline.
      WHEN 'delegate_c'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->create_entity( EXPORTING io_data_provider        = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                                                             io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                                   IMPORTING es_data                 = er_entity ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'delegate_d'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->delete_entity( io_tech_request_context ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'delegate_q'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->get_entityset( EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                                   IMPORTING et_data                 = et_entityset`
      && cl_abap_char_utilities=>newline
      && `                                                             es_response_context     = es_response_context ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'delegate_r'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->get_entity( EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                                IMPORTING es_data                 = er_entity ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'delegate_u'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->update_entity( EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                                             io_data_provider        = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                                                   IMPORTING es_data                 = er_entity ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'dispatch_c'.
        rv_text = ``
      && `{{! SEGW writes a literal tab before IMPORTING; the operation model supplies it. }}`
      && cl_abap_char_utilities=>newline
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `*&----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*&  Include           /IWBEP/DPC_TEMP_CRT_ENTITY_BASE`
      && cl_abap_char_utilities=>newline
      && `*&* This class has been generated on {{generated_on}} in client {{client}}`
      && cl_abap_char_utilities=>newline
      && `*&*`
      && cl_abap_char_utilities=>newline
      && `*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING`
      && cl_abap_char_utilities=>newline
      && `*&*   If you want to change the DPC implementation, use the`
      && cl_abap_char_utilities=>newline
      && `*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>ts_{{type_stem_lower}}.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}} DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CASE lv_entityset_name.`
      && cl_abap_char_utilities=>newline
      && `{{#cases}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             EntitySet -  {{set_name}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `     WHEN '{{set_name}}'.`
      && cl_abap_char_utilities=>newline
      && `*     Call the entity set generated method`
      && cl_abap_char_utilities=>newline
      && `    {{method_lower}}(`
      && cl_abap_char_utilities=>newline
      && `         EXPORTING iv_entity_name     = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `                   iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `                   iv_source_name     = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `                   io_data_provider   = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                   it_key_tab         = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `                   it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `                   io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `       {{tab}} IMPORTING er_entity          = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `    ).`
      && cl_abap_char_utilities=>newline
      && `*     Send specific entity data to the caller interfaces`
      && cl_abap_char_utilities=>newline
      && `    copy_data_to_ref(`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `        is_data = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `      CHANGING`
      && cl_abap_char_utilities=>newline
      && `        cr_data = er_entity`
      && cl_abap_char_utilities=>newline
      && `   ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{/cases}}`
      && cl_abap_char_utilities=>newline
      && `  when others.`
      && cl_abap_char_utilities=>newline
      && `    super->/iwbep/if_mgw_appl_srv_runtime~create_entity(`
      && cl_abap_char_utilities=>newline
      && `       EXPORTING`
      && cl_abap_char_utilities=>newline
      && `         iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `         iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `         iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `         io_data_provider   = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `         it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `         it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `      IMPORTING`
      && cl_abap_char_utilities=>newline
      && `        er_entity = er_entity`
      && cl_abap_char_utilities=>newline
      && `  ).`
      && cl_abap_char_utilities=>newline
      && `ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'dispatch_d'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~DELETE_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `*&----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*&  Include           /IWBEP/DPC_TEMP_DEL_ENTITY_BASE`
      && cl_abap_char_utilities=>newline
      && `*&* This class has been generated on {{generated_on}} in client {{client}}`
      && cl_abap_char_utilities=>newline
      && `*&*`
      && cl_abap_char_utilities=>newline
      && `*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING`
      && cl_abap_char_utilities=>newline
      && `*&*   If you want to change the DPC implementation, use the`
      && cl_abap_char_utilities=>newline
      && `*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CASE lv_entityset_name.`
      && cl_abap_char_utilities=>newline
      && `{{#cases}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             EntitySet -  {{set_name}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `      when '{{set_name}}'.`
      && cl_abap_char_utilities=>newline
      && `*     Call the entity set generated method`
      && cl_abap_char_utilities=>newline
      && `     {{method_lower}}(`
      && cl_abap_char_utilities=>newline
      && `          EXPORTING iv_entity_name     = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `                    iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `                    iv_source_name     = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `                    it_key_tab         = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `                    it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `                    io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `     ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{/cases}}`
      && cl_abap_char_utilities=>newline
      && `   when others.`
      && cl_abap_char_utilities=>newline
      && `     super->/iwbep/if_mgw_appl_srv_runtime~delete_entity(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `          iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `          iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `          it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `          it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && ` ).`
      && cl_abap_char_utilities=>newline
      && ` ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'dispatch_q'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITYSET.`
      && cl_abap_char_utilities=>newline
      && `*&----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*&  Include           /IWBEP/DPC_TMP_ENTITYSET_BASE`
      && cl_abap_char_utilities=>newline
      && `*&* This class has been generated on {{generated_on}} in client {{client}}`
      && cl_abap_char_utilities=>newline
      && `*&*`
      && cl_abap_char_utilities=>newline
      && `*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING`
      && cl_abap_char_utilities=>newline
      && `*&*   If you want to change the DPC implementation, use the`
      && cl_abap_char_utilities=>newline
      && `*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>tt_{{type_stem_lower}}.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}} DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CASE lv_entityset_name.`
      && cl_abap_char_utilities=>newline
      && `{{#cases}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             EntitySet -  {{set_name}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `   WHEN '{{set_name}}'.`
      && cl_abap_char_utilities=>newline
      && `*     Call the entity set generated method`
      && cl_abap_char_utilities=>newline
      && `      {{method_lower}}(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `         iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `         iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `         iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `         it_filter_select_options = it_filter_select_options`
      && cl_abap_char_utilities=>newline
      && `         it_order = it_order`
      && cl_abap_char_utilities=>newline
      && `         is_paging = is_paging`
      && cl_abap_char_utilities=>newline
      && `         it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `         it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `         iv_filter_string = iv_filter_string`
      && cl_abap_char_utilities=>newline
      && `         iv_search_string = iv_search_string`
      && cl_abap_char_utilities=>newline
      && `         io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `       IMPORTING`
      && cl_abap_char_utilities=>newline
      && `         et_entityset = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `         es_response_context = es_response_context`
      && cl_abap_char_utilities=>newline
      && `       ).`
      && cl_abap_char_utilities=>newline
      && `*     Send specific entity data to the caller interface`
      && cl_abap_char_utilities=>newline
      && `      copy_data_to_ref(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          is_data = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `        CHANGING`
      && cl_abap_char_utilities=>newline
      && `          cr_data = er_entityset`
      && cl_abap_char_utilities=>newline
      && `      ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{/cases}}`
      && cl_abap_char_utilities=>newline
      && `    WHEN OTHERS.`
      && cl_abap_char_utilities=>newline
      && `      super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `          iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `          iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `          it_filter_select_options = it_filter_select_options`
      && cl_abap_char_utilities=>newline
      && `          it_order = it_order`
      && cl_abap_char_utilities=>newline
      && `          is_paging = is_paging`
      && cl_abap_char_utilities=>newline
      && `          it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `          it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `          iv_filter_string = iv_filter_string`
      && cl_abap_char_utilities=>newline
      && `          iv_search_string = iv_search_string`
      && cl_abap_char_utilities=>newline
      && `          io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `       IMPORTING`
      && cl_abap_char_utilities=>newline
      && `         er_entityset = er_entityset ).`
      && cl_abap_char_utilities=>newline
      && ` ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'dispatch_r'.
        rv_text = ``
      && `{{! GET_ENTITY's banner has 95 leading dashes and two spaces before 'on'. }}`
      && cl_abap_char_utilities=>newline
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*&  Include           /IWBEP/DPC_TEMP_GETENTITY_BASE`
      && cl_abap_char_utilities=>newline
      && `*&* This class has been generated  on {{generated_on}} in client {{client}}`
      && cl_abap_char_utilities=>newline
      && `*&*`
      && cl_abap_char_utilities=>newline
      && `*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING`
      && cl_abap_char_utilities=>newline
      && `*&*   If you want to change the DPC implementation, use the`
      && cl_abap_char_utilities=>newline
      && `*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>ts_{{type_stem_lower}}.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}} DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && ` DATA lr_entity TYPE REF TO data.       "#EC NEEDED`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CASE lv_entityset_name.`
      && cl_abap_char_utilities=>newline
      && `{{#cases}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             EntitySet -  {{set_name}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `      WHEN '{{set_name}}'.`
      && cl_abap_char_utilities=>newline
      && `*     Call the entity set generated method`
      && cl_abap_char_utilities=>newline
      && `          {{method_lower}}(`
      && cl_abap_char_utilities=>newline
      && `               EXPORTING iv_entity_name     = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `                         iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `                         iv_source_name     = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `                         it_key_tab         = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `                         it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `                         io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `             {{tab}} IMPORTING er_entity          = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `                         es_response_context = es_response_context`
      && cl_abap_char_utilities=>newline
      && `          ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `        IF {{method_lower}} IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `*     Send specific entity data to the caller interface`
      && cl_abap_char_utilities=>newline
      && `          copy_data_to_ref(`
      && cl_abap_char_utilities=>newline
      && `            EXPORTING`
      && cl_abap_char_utilities=>newline
      && `              is_data = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `            CHANGING`
      && cl_abap_char_utilities=>newline
      && `              cr_data = er_entity`
      && cl_abap_char_utilities=>newline
      && `          ).`
      && cl_abap_char_utilities=>newline
      && `        ELSE.`
      && cl_abap_char_utilities=>newline
      && `*         In case of initial values - unbind the entity reference`
      && cl_abap_char_utilities=>newline
      && `          er_entity = lr_entity.`
      && cl_abap_char_utilities=>newline
      && `        ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `      WHEN OTHERS.`
      && cl_abap_char_utilities=>newline
      && `        super->/iwbep/if_mgw_appl_srv_runtime~get_entity(`
      && cl_abap_char_utilities=>newline
      && `           EXPORTING`
      && cl_abap_char_utilities=>newline
      && `             iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `             iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `             iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `             it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `             it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `          IMPORTING`
      && cl_abap_char_utilities=>newline
      && `            er_entity = er_entity`
      && cl_abap_char_utilities=>newline
      && `    ).`
      && cl_abap_char_utilities=>newline
      && ` ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'dispatch_u'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~UPDATE_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `*&----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*&  Include           /IWBEP/DPC_TEMP_UPD_ENTITY_BASE`
      && cl_abap_char_utilities=>newline
      && `*&* This class has been generated on {{generated_on}} in client {{client}}`
      && cl_abap_char_utilities=>newline
      && `*&*`
      && cl_abap_char_utilities=>newline
      && `*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING`
      && cl_abap_char_utilities=>newline
      && `*&*   If you want to change the DPC implementation, use the`
      && cl_abap_char_utilities=>newline
      && `*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}`
      && cl_abap_char_utilities=>newline
      && `*&-----------------------------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>ts_{{type_stem_lower}}.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}} DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && ` DATA lr_entity TYPE REF TO data. "#EC NEEDED`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CASE lv_entityset_name.`
      && cl_abap_char_utilities=>newline
      && `{{#cases}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             EntitySet -  {{set_name}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `      WHEN '{{set_name}}'.`
      && cl_abap_char_utilities=>newline
      && `*     Call the entity set generated method`
      && cl_abap_char_utilities=>newline
      && `          {{method_lower}}(`
      && cl_abap_char_utilities=>newline
      && `               EXPORTING iv_entity_name     = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `                         iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `                         iv_source_name     = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `                         io_data_provider   = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                         it_key_tab         = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `                         it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `                         io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `             {{tab}} IMPORTING er_entity          = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `          ).`
      && cl_abap_char_utilities=>newline
      && `       IF {{method_lower}} IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `*     Send specific entity data to the caller interface`
      && cl_abap_char_utilities=>newline
      && `          copy_data_to_ref(`
      && cl_abap_char_utilities=>newline
      && `            EXPORTING`
      && cl_abap_char_utilities=>newline
      && `              is_data = {{method_lower}}`
      && cl_abap_char_utilities=>newline
      && `            CHANGING`
      && cl_abap_char_utilities=>newline
      && `              cr_data = er_entity`
      && cl_abap_char_utilities=>newline
      && `          ).`
      && cl_abap_char_utilities=>newline
      && `        ELSE.`
      && cl_abap_char_utilities=>newline
      && `*         In case of initial values - unbind the entity reference`
      && cl_abap_char_utilities=>newline
      && `          er_entity = lr_entity.`
      && cl_abap_char_utilities=>newline
      && `        ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/cases}}`
      && cl_abap_char_utilities=>newline
      && `      WHEN OTHERS.`
      && cl_abap_char_utilities=>newline
      && `        super->/iwbep/if_mgw_appl_srv_runtime~update_entity(`
      && cl_abap_char_utilities=>newline
      && `           EXPORTING`
      && cl_abap_char_utilities=>newline
      && `             iv_entity_name = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `             iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `             iv_source_name = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `             io_data_provider   = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `             it_key_tab = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `             it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `          IMPORTING`
      && cl_abap_char_utilities=>newline
      && `            er_entity = er_entity`
      && cl_abap_char_utilities=>newline
      && `    ).`
      && cl_abap_char_utilities=>newline
      && ` ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_check_subscription_authority'.
        rv_text = ``
      && `  method CHECK_SUBSCRIPTION_AUTHORITY.`
      && cl_abap_char_utilities=>newline
      && `  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented`
      && cl_abap_char_utilities=>newline
      && `      method = 'CHECK_SUBSCRIPTION_AUTHORITY'.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_commit_work'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~COMMIT_WORK.`
      && cl_abap_char_utilities=>newline
      && `* Call RFC commit work functionality`
      && cl_abap_char_utilities=>newline
      && `DATA lt_message      TYPE bapiret2. "#EC NEEDED`
      && cl_abap_char_utilities=>newline
      && `DATA lv_message_text TYPE BAPI_MSG.`
      && cl_abap_char_utilities=>newline
      && `DATA lo_logger       TYPE REF TO /iwbep/cl_cos_logger.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_subrc        TYPE syst-subrc.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  IF iv_rfc_dest IS INITIAL OR iv_rfc_dest EQ 'NONE'.`
      && cl_abap_char_utilities=>newline
      && `    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      wait   = abap_true`
      && cl_abap_char_utilities=>newline
      && `    IMPORTING`
      && cl_abap_char_utilities=>newline
      && `      return = lt_message.`
      && cl_abap_char_utilities=>newline
      && `  ELSE.`
      && cl_abap_char_utilities=>newline
      && `    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'`
      && cl_abap_char_utilities=>newline
      && `      DESTINATION iv_rfc_dest`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      wait                  = abap_true`
      && cl_abap_char_utilities=>newline
      && `    IMPORTING`
      && cl_abap_char_utilities=>newline
      && `      return                = lt_message`
      && cl_abap_char_utilities=>newline
      && `    EXCEPTIONS`
      && cl_abap_char_utilities=>newline
      && `      communication_failure = 1000 MESSAGE lv_message_text`
      && cl_abap_char_utilities=>newline
      && `      system_failure        = 1001 MESSAGE lv_message_text`
      && cl_abap_char_utilities=>newline
      && `      OTHERS                = 1002.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  IF sy-subrc <> 0.`
      && cl_abap_char_utilities=>newline
      && `    lv_subrc = sy-subrc.`
      && cl_abap_char_utilities=>newline
      && `    /iwbep/cl_sb_gen_dpc_rt_util=>rfc_exception_handling(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          iv_subrc            = lv_subrc`
      && cl_abap_char_utilities=>newline
      && `          iv_exp_message_text = lv_message_text`
      && cl_abap_char_utilities=>newline
      && `          io_logger           = lo_logger ).`
      && cl_abap_char_utilities=>newline
      && `  ENDIF.`
      && cl_abap_char_utilities=>newline
      && `  ENDIF.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_get_generation_strategy'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~GET_GENERATION_STRATEGY.`
      && cl_abap_char_utilities=>newline
      && `* Get generation strategy`
      && cl_abap_char_utilities=>newline
      && `  rv_generation_strategy = '1'.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_log_message'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~LOG_MESSAGE.`
      && cl_abap_char_utilities=>newline
      && `* Log message in the application log`
      && cl_abap_char_utilities=>newline
      && `DATA lo_logger TYPE REF TO /iwbep/cl_cos_logger.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_text TYPE /iwbep/sup_msg_longtext.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  MESSAGE ID iv_msg_id TYPE iv_msg_type NUMBER iv_msg_number`
      && cl_abap_char_utilities=>newline
      && `    WITH iv_msg_v1 iv_msg_v2 iv_msg_v3 iv_msg_v4 INTO lv_text.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  lo_logger = mo_context->get_logger( ).`
      && cl_abap_char_utilities=>newline
      && `  lo_logger->log_message(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_type   = iv_msg_type`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_id     = iv_msg_id`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_number = iv_msg_number`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_text   = lv_text`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_v1     = iv_msg_v1`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_v2     = iv_msg_v2`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_v3     = iv_msg_v3`
      && cl_abap_char_utilities=>newline
      && `     iv_msg_v4     = iv_msg_v4`
      && cl_abap_char_utilities=>newline
      && `     iv_agent      = 'DPC' ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_rfc_exception_handling'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_EXCEPTION_HANDLING.`
      && cl_abap_char_utilities=>newline
      && `* RFC call exception handling`
      && cl_abap_char_utilities=>newline
      && `DATA lo_logger  TYPE REF TO /iwbep/cl_cos_logger.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `/iwbep/cl_sb_gen_dpc_rt_util=>rfc_exception_handling(`
      && cl_abap_char_utilities=>newline
      && `  EXPORTING`
      && cl_abap_char_utilities=>newline
      && `    iv_subrc            = iv_subrc`
      && cl_abap_char_utilities=>newline
      && `    iv_exp_message_text = iv_exp_message_text`
      && cl_abap_char_utilities=>newline
      && `    io_logger           = lo_logger ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_rfc_save_log'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_SAVE_LOG.`
      && cl_abap_char_utilities=>newline
      && `  DATA lo_logger  TYPE REF TO /iwbep/cl_cos_logger.`
      && cl_abap_char_utilities=>newline
      && `  DATA lo_message_container TYPE REF TO /iwbep/if_message_container.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).`
      && cl_abap_char_utilities=>newline
      && `  lo_message_container = /iwbep/if_mgw_conv_srv_runtime~get_message_container( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  " Save the RFC call log in the application log`
      && cl_abap_char_utilities=>newline
      && `  /iwbep/cl_sb_gen_dpc_rt_util=>rfc_save_log(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      is_return            = is_return`
      && cl_abap_char_utilities=>newline
      && `      iv_entity_type       = iv_entity_type`
      && cl_abap_char_utilities=>newline
      && `      it_return            = it_return`
      && cl_abap_char_utilities=>newline
      && `      it_key_tab           = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `      io_logger            = lo_logger`
      && cl_abap_char_utilities=>newline
      && `      io_message_container = lo_message_container ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'fixed_set_injection'.
        rv_text = ``
      && `  method /IWBEP/IF_SB_DPC_COMM_SERVICES~SET_INJECTION.`
      && cl_abap_char_utilities=>newline
      && `* Unit test injection`
      && cl_abap_char_utilities=>newline
      && `  IF io_unit IS BOUND.`
      && cl_abap_char_utilities=>newline
      && `    mo_injection = io_unit.`
      && cl_abap_char_utilities=>newline
      && `  ELSE.`
      && cl_abap_char_utilities=>newline
      && `    mo_injection = me.`
      && cl_abap_char_utilities=>newline
      && `  ENDIF.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'odc_q'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    DATA lo_client TYPE REF TO zcl_stg_odata_client.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* served by {{remote_service}}/{{remote_set}}, another service of this registry`
      && cl_abap_char_utilities=>newline
      && `    CREATE OBJECT lo_client`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `        iv_service    = '{{remote_service}}'`
      && cl_abap_char_utilities=>newline
      && `        iv_entity_set = '{{remote_set}}'.`
      && cl_abap_char_utilities=>newline
      && `    lo_client->get_entityset(`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `        io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `        iv_local_service        = '{{service}}'`
      && cl_abap_char_utilities=>newline
      && `        iv_local_set            = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `      IMPORTING`
      && cl_abap_char_utilities=>newline
      && `        et_entityset            = et_entityset`
      && cl_abap_char_utilities=>newline
      && `        es_response_context     = es_response_context ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'odc_r'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `    DATA lo_client TYPE REF TO zcl_stg_odata_client.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* served by {{remote_service}}/{{remote_set}}, another service of this registry`
      && cl_abap_char_utilities=>newline
      && `    CREATE OBJECT lo_client`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `        iv_service    = '{{remote_service}}'`
      && cl_abap_char_utilities=>newline
      && `        iv_entity_set = '{{remote_set}}'.`
      && cl_abap_char_utilities=>newline
      && `    lo_client->get_entity(`
      && cl_abap_char_utilities=>newline
      && `      EXPORTING`
      && cl_abap_char_utilities=>newline
      && `        it_key_tab       = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `        iv_local_service = '{{service}}'`
      && cl_abap_char_utilities=>newline
      && `        iv_local_set     = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `      IMPORTING`
      && cl_abap_char_utilities=>newline
      && `        es_entity        = er_entity ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_create_deep_entity'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_DEEP_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `    CAST /iwbep/if_mgw_appl_srv_runtime( if_sadl_gw_dpc_util~get_dpc( ) )->create_deep_entity(`
      && cl_abap_char_utilities=>newline
      && `                   EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                             io_data_provider        = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                             io_expand               = io_expand`
      && cl_abap_char_utilities=>newline
      && `                   IMPORTING er_deep_entity          = er_deep_entity ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_execute_action'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~EXECUTE_ACTION.`
      && cl_abap_char_utilities=>newline
      && `    if_sadl_gw_dpc_util~get_dpc( )->execute_action( EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                                    IMPORTING er_data                 = er_data ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_get_dpc'.
        rv_text = ``
      && `{{! SEGW lists SADL data sources forward and result structures in reverse set order. }}`
      && cl_abap_char_utilities=>newline
      && `  method IF_SADL_GW_DPC_UTIL~GET_DPC.`
      && cl_abap_char_utilities=>newline
      && `{{#refs}}    TYPES ty_{{binding}}_{{index}} TYPE {{binding_lower}} ##NEEDED. " reference for where-used list`
      && cl_abap_char_utilities=>newline
      && `{{/refs}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `    DATA(lv_sadl_xml) =`
      && cl_abap_char_utilities=>newline
      && `               |<?xml version="1.0" encoding="utf-16"?>| &`
      && cl_abap_char_utilities=>newline
      && `               |<sadl:definition xmlns:sadl="http://sap.com/sap.nw.f.sadl" syntaxVersion="V2" >| &`
      && cl_abap_char_utilities=>newline
      && `{{#sadl_sources}}               | <sadl:dataSource type="{{type}}" name="{{name}}" binding="{{binding}}" />| &`
      && cl_abap_char_utilities=>newline
      && `{{/sadl_sources}}               |<sadl:resultSet>| &`
      && cl_abap_char_utilities=>newline
      && `{{#sadl_structures}}               |<sadl:structure name="{{name}}" dataSource="{{name}}" maxEditMode="{{edit_mode}}" >| &`
      && cl_abap_char_utilities=>newline
      && `               | <sadl:query name="EntitySetDefault">| &`
      && cl_abap_char_utilities=>newline
      && `               | </sadl:query>| &`
      && cl_abap_char_utilities=>newline
      && `{{#properties}}               | <sadl:attribute name="{{abap_field}}" binding="{{abap_field}}" isOutput="TRUE" isKey="{{key}}" />| &`
      && cl_abap_char_utilities=>newline
      && `{{/properties}}               |</sadl:structure>| &`
      && cl_abap_char_utilities=>newline
      && `{{/sadl_structures}}               |</sadl:resultSet>| &`
      && cl_abap_char_utilities=>newline
      && `               |</sadl:definition>| .`
      && cl_abap_char_utilities=>newline
      && `    ro_dpc = cl_sadl_gw_dpc_factory=>create_for_sadl( iv_sadl_xml   = lv_sadl_xml`
      && cl_abap_char_utilities=>newline
      && `               iv_timestamp         = {{generated_at}}`
      && cl_abap_char_utilities=>newline
      && `               iv_uuid              = '{{project}}'`
      && cl_abap_char_utilities=>newline
      && `               io_query_control     = me`
      && cl_abap_char_utilities=>newline
      && `               io_extension_control = me`
      && cl_abap_char_utilities=>newline
      && `               io_context           = me->mo_context ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_get_is_condi_imple_for_action'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDI_IMPLE_FOR_ACTION.`
      && cl_abap_char_utilities=>newline
      && `    TRY.`
      && cl_abap_char_utilities=>newline
      && `        rv_conditional_active = if_sadl_gw_dpc_util~get_dpc( )->get_is_condi_imple_for_action( iv_action_name ).`
      && cl_abap_char_utilities=>newline
      && `      CATCH /iwbep/cx_mgw_tech_exception /iwbep/cx_mgw_busi_exception.`
      && cl_abap_char_utilities=>newline
      && `        rv_conditional_active = super->/iwbep/if_mgw_appl_srv_runtime~get_is_condi_imple_for_action( iv_action_name ).`
      && cl_abap_char_utilities=>newline
      && `    ENDTRY.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_get_is_conditional_implemented'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDITIONAL_IMPLEMENTED.`
      && cl_abap_char_utilities=>newline
      && `    TRY.`
      && cl_abap_char_utilities=>newline
      && `        rv_conditional_active = if_sadl_gw_dpc_util~get_dpc( )->get_is_conditional_implemented(`
      && cl_abap_char_utilities=>newline
      && `                                               iv_operation_type  = iv_operation_type`
      && cl_abap_char_utilities=>newline
      && `                                               iv_entity_set_name = iv_entity_set_name ).`
      && cl_abap_char_utilities=>newline
      && `      CATCH /iwbep/cx_mgw_tech_exception /iwbep/cx_mgw_busi_exception.`
      && cl_abap_char_utilities=>newline
      && `        rv_conditional_active = super->/iwbep/if_mgw_appl_srv_runtime~get_is_conditional_implemented(`
      && cl_abap_char_utilities=>newline
      && `                                       iv_operation_type     = iv_operation_type`
      && cl_abap_char_utilities=>newline
      && `                                       iv_entity_set_name    = iv_entity_set_name ).`
      && cl_abap_char_utilities=>newline
      && `    ENDTRY.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_patch_entity'.
        rv_text = ``
      && `  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~PATCH_ENTITY.`
      && cl_abap_char_utilities=>newline
      && `        super->/iwbep/if_mgw_appl_srv_runtime~patch_entity(`
      && cl_abap_char_utilities=>newline
      && `                       EXPORTING io_tech_request_context = io_tech_request_context`
      && cl_abap_char_utilities=>newline
      && `                                 io_data_provider        = io_data_provider`
      && cl_abap_char_utilities=>newline
      && `                                 iv_entity_name          = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `                                 iv_entity_set_name      = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `                                 iv_source_name          = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `                                 it_key_tab              = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `                                 it_navigation_path      = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `                       IMPORTING er_entity               = er_entity  ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_set_extension_mapping'.
        rv_text = ``
      && `  method IF_SADL_GW_EXTENSION_CONTROL~SET_EXTENSION_MAPPING.`
      && cl_abap_char_utilities=>newline
      && `" Intended to be overwritten`
      && cl_abap_char_utilities=>newline
      && `RETURN.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'sadl_set_query_options'.
        rv_text = ``
      && `  method IF_SADL_GW_QUERY_CONTROL~SET_QUERY_OPTIONS.`
      && cl_abap_char_utilities=>newline
      && `" Intended to be overwritten`
      && cl_abap_char_utilities=>newline
      && `RETURN.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'signature_c'.
        rv_text = ``
      && `  methods {{method}}`
      && cl_abap_char_utilities=>newline
      && `    importing`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_SET_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SOURCE_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR`
      && cl_abap_char_utilities=>newline
      && `      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_C optional`
      && cl_abap_char_utilities=>newline
      && `      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH`
      && cl_abap_char_utilities=>newline
      && `      !IO_DATA_PROVIDER type ref to /IWBEP/IF_MGW_ENTRY_PROVIDER optional`
      && cl_abap_char_utilities=>newline
      && `    exporting`
      && cl_abap_char_utilities=>newline
      && `      !ER_ENTITY type {{mpc}}=>TS_{{type_stem}}`
      && cl_abap_char_utilities=>newline
      && `    raising`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_BUSI_EXCEPTION`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_TECH_EXCEPTION .`
      && cl_abap_char_utilities=>newline.
      WHEN 'signature_d'.
        rv_text = ``
      && `  methods {{method}}`
      && cl_abap_char_utilities=>newline
      && `    importing`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_SET_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SOURCE_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR`
      && cl_abap_char_utilities=>newline
      && `      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_D optional`
      && cl_abap_char_utilities=>newline
      && `      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH`
      && cl_abap_char_utilities=>newline
      && `    raising`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_BUSI_EXCEPTION`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_TECH_EXCEPTION .`
      && cl_abap_char_utilities=>newline.
      WHEN 'signature_q'.
        rv_text = ``
      && `  methods {{method}}`
      && cl_abap_char_utilities=>newline
      && `    importing`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_SET_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SOURCE_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IT_FILTER_SELECT_OPTIONS type /IWBEP/T_MGW_SELECT_OPTION`
      && cl_abap_char_utilities=>newline
      && `      !IS_PAGING type /IWBEP/S_MGW_PAGING`
      && cl_abap_char_utilities=>newline
      && `      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR`
      && cl_abap_char_utilities=>newline
      && `      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH`
      && cl_abap_char_utilities=>newline
      && `      !IT_ORDER type /IWBEP/T_MGW_SORTING_ORDER`
      && cl_abap_char_utilities=>newline
      && `      !IV_FILTER_STRING type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SEARCH_STRING type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITYSET optional`
      && cl_abap_char_utilities=>newline
      && `    exporting`
      && cl_abap_char_utilities=>newline
      && `      !ET_ENTITYSET type {{mpc}}=>TT_{{type_stem}}`
      && cl_abap_char_utilities=>newline
      && `      !ES_RESPONSE_CONTEXT type /IWBEP/IF_MGW_APPL_SRV_RUNTIME=>TY_S_MGW_RESPONSE_CONTEXT`
      && cl_abap_char_utilities=>newline
      && `    raising`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_BUSI_EXCEPTION`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_TECH_EXCEPTION .`
      && cl_abap_char_utilities=>newline.
      WHEN 'signature_r'.
        rv_text = ``
      && `  methods {{method}}`
      && cl_abap_char_utilities=>newline
      && `    importing`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_SET_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SOURCE_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR`
      && cl_abap_char_utilities=>newline
      && `      !IO_REQUEST_OBJECT type ref to /IWBEP/IF_MGW_REQ_ENTITY optional`
      && cl_abap_char_utilities=>newline
      && `      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY optional`
      && cl_abap_char_utilities=>newline
      && `      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH`
      && cl_abap_char_utilities=>newline
      && `    exporting`
      && cl_abap_char_utilities=>newline
      && `      !ER_ENTITY type {{mpc}}=>TS_{{type_stem}}`
      && cl_abap_char_utilities=>newline
      && `      !ES_RESPONSE_CONTEXT type /IWBEP/IF_MGW_APPL_SRV_RUNTIME=>TY_S_MGW_RESPONSE_ENTITY_CNTXT`
      && cl_abap_char_utilities=>newline
      && `    raising`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_BUSI_EXCEPTION`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_TECH_EXCEPTION .`
      && cl_abap_char_utilities=>newline.
      WHEN 'signature_u'.
        rv_text = ``
      && `  methods {{method}}`
      && cl_abap_char_utilities=>newline
      && `    importing`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_ENTITY_SET_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IV_SOURCE_NAME type STRING`
      && cl_abap_char_utilities=>newline
      && `      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR`
      && cl_abap_char_utilities=>newline
      && `      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_U optional`
      && cl_abap_char_utilities=>newline
      && `      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH`
      && cl_abap_char_utilities=>newline
      && `      !IO_DATA_PROVIDER type ref to /IWBEP/IF_MGW_ENTRY_PROVIDER optional`
      && cl_abap_char_utilities=>newline
      && `    exporting`
      && cl_abap_char_utilities=>newline
      && `      !ER_ENTITY type {{mpc}}=>TS_{{type_stem}}`
      && cl_abap_char_utilities=>newline
      && `    raising`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_BUSI_EXCEPTION`
      && cl_abap_char_utilities=>newline
      && `      /IWBEP/CX_MGW_TECH_EXCEPTION .`
      && cl_abap_char_utilities=>newline.
      WHEN 'stub'.
        rv_text = ``
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `{{#missing_rfc}}* Mapped to {{function_name}}: the function group was not available when this class was generated`
      && cl_abap_char_utilities=>newline
      && `{{/missing_rfc}}  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented`
      && cl_abap_char_utilities=>newline
      && `      method = '{{method}}'.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
    ENDCASE.
  ENDMETHOD.
  METHOD names.
    APPEND 'delegate_c' TO rt_names.
    APPEND 'delegate_d' TO rt_names.
    APPEND 'delegate_q' TO rt_names.
    APPEND 'delegate_r' TO rt_names.
    APPEND 'delegate_u' TO rt_names.
    APPEND 'dispatch_c' TO rt_names.
    APPEND 'dispatch_d' TO rt_names.
    APPEND 'dispatch_q' TO rt_names.
    APPEND 'dispatch_r' TO rt_names.
    APPEND 'dispatch_u' TO rt_names.
    APPEND 'fixed_check_subscription_authority' TO rt_names.
    APPEND 'fixed_commit_work' TO rt_names.
    APPEND 'fixed_get_generation_strategy' TO rt_names.
    APPEND 'fixed_log_message' TO rt_names.
    APPEND 'fixed_rfc_exception_handling' TO rt_names.
    APPEND 'fixed_rfc_save_log' TO rt_names.
    APPEND 'fixed_set_injection' TO rt_names.
    APPEND 'odc_q' TO rt_names.
    APPEND 'odc_r' TO rt_names.
    APPEND 'sadl_create_deep_entity' TO rt_names.
    APPEND 'sadl_execute_action' TO rt_names.
    APPEND 'sadl_get_dpc' TO rt_names.
    APPEND 'sadl_get_is_condi_imple_for_action' TO rt_names.
    APPEND 'sadl_get_is_conditional_implemented' TO rt_names.
    APPEND 'sadl_patch_entity' TO rt_names.
    APPEND 'sadl_set_extension_mapping' TO rt_names.
    APPEND 'sadl_set_query_options' TO rt_names.
    APPEND 'signature_c' TO rt_names.
    APPEND 'signature_d' TO rt_names.
    APPEND 'signature_q' TO rt_names.
    APPEND 'signature_r' TO rt_names.
    APPEND 'signature_u' TO rt_names.
    APPEND 'stub' TO rt_names.
  ENDMETHOD.
ENDCLASS.
