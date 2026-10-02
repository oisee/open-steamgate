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
      && `xtension_mapping}}{{> sadl_set_extension_mapping}}{{/sadl_set_extension_mapping}}{{#sadl_set_query_options}}{{> sadl_set_query_options}}{{/sadl_set_query_options}}{{#shlp`
      && `_interface}}{{> shlp-interface}}{{/shlp_interface}}{{#rfc_mapped}}{{#mapping}}{{#is_r}}{{> rfc-read}}{{/is_r}}{{#is_q}}{{> rfc-query}}{{/is_q}}{{#is_c}}{{> rfc-create}}{{`
      && `/is_c}}{{#is_u}}{{> rfc-update}}{{/is_u}}{{#is_d}}{{> rfc-delete}}{{/is_d}}{{/mapping}}{{/rfc_mapped}}{{#shlp_mapped}}{{#mapping}}{{#is_q}}{{> shlp-query}}{{/is_q}}{{#is_`
      && `r}}{{> shlp-read}}{{/is_r}}{{/mapping}}{{/shlp_mapped}}{{/impls}}ENDCLASS.`
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
      WHEN 'rfc-append_constant_lines'.
        rv_text = ``
      && `{{! Table constants append one nonempty row per parameter after all assignments. }}`
      && cl_abap_char_utilities=>newline
      && `{{#has_constant_tables}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Append lines of table parameters in the function call`
      && cl_abap_char_utilities=>newline
      && `{{#constant_tables}} IF ls_{{name}} IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   APPEND ls_{{name}} TO {{name}}.`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/constant_tables}}`
      && cl_abap_char_utilities=>newline
      && `{{/has_constant_tables}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-call_function'.
        rv_text = ``
      && `{{! Local widths start at 14, remote at 21. Local TRY catches cx_root; remote adds communication_failure. Parameter order stays mapping order. }}`
      && cl_abap_char_utilities=>newline
      && ` IF lv_destination IS INITIAL OR lv_destination EQ 'NONE'.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `   TRY.`
      && cl_abap_char_utilities=>newline
      && `       CALL FUNCTION lv_rfc_name`
      && cl_abap_char_utilities=>newline
      && `{{#groups}}         {{#is_importing}}EXPORTING{{/is_importing}}{{#is_exporting}}IMPORTING{{/is_exporting}}{{#is_tables}}TABLES{{/is_tables}}{{#is_changing}}CHANGING{{/is_`
      && `changing}}`
      && cl_abap_char_utilities=>newline
      && `{{#parameters}}           {{name}}{{local_gap}} = {{name}}`
      && cl_abap_char_utilities=>newline
      && `{{/parameters}}{{/groups}}{{#exceptions}}         EXCEPTIONS`
      && cl_abap_char_utilities=>newline
      && `           system_failure{{exceptions.local_system_failure_gap}} = {{exceptions.system_failure_code}}  MESSAGE lv_exc_msg`
      && cl_abap_char_utilities=>newline
      && `           OTHERS{{exceptions.local_others_gap}} = {{exceptions.others_code}}.`
      && cl_abap_char_utilities=>newline
      && `{{/exceptions}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `       lv_subrc = sy-subrc.`
      && cl_abap_char_utilities=>newline
      && `*in case of co-deployment the exception is raised and needs to be caught`
      && cl_abap_char_utilities=>newline
      && `     CATCH cx_root INTO lx_root.`
      && cl_abap_char_utilities=>newline
      && `       lv_subrc = {{exceptions.caught_code}}.`
      && cl_abap_char_utilities=>newline
      && `       lv_exc_msg = lx_root->if_message~get_text( ).`
      && cl_abap_char_utilities=>newline
      && `   ENDTRY.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` ELSE.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `   CALL FUNCTION lv_rfc_name DESTINATION lv_destination`
      && cl_abap_char_utilities=>newline
      && `{{#groups}}     {{#is_importing}}EXPORTING{{/is_importing}}{{#is_exporting}}IMPORTING{{/is_exporting}}{{#is_tables}}TABLES{{/is_tables}}{{#is_changing}}CHANGING{{/is_chan`
      && `ging}}`
      && cl_abap_char_utilities=>newline
      && `{{#parameters}}       {{name}}{{remote_gap}} = {{name}}`
      && cl_abap_char_utilities=>newline
      && `{{/parameters}}{{/groups}}{{#exceptions}}     EXCEPTIONS`
      && cl_abap_char_utilities=>newline
      && `       system_failure{{exceptions.remote_system_failure_gap}} = {{exceptions.system_failure_code}}  MESSAGE lv_exc_msg`
      && cl_abap_char_utilities=>newline
      && `       communication_failure{{exceptions.remote_communication_failure_gap}} = {{exceptions.communication_failure_code}}  MESSAGE lv_exc_msg`
      && cl_abap_char_utilities=>newline
      && `       OTHERS{{exceptions.remote_others_gap}} = {{exceptions.others_code}}.`
      && cl_abap_char_utilities=>newline
      && `{{/exceptions}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `   lv_subrc = sy-subrc.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-commit'.
        rv_text = ``
      && `{{! SEGW emits a leading blank before commit, uneven EXPORTING indentation, and the closing spelling ) . }}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Call RFC commit work`
      && cl_abap_char_utilities=>newline
      && ` me->/iwbep/if_sb_dpc_comm_services~commit_work(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          iv_rfc_dest = lv_destination`
      && cl_abap_char_utilities=>newline
      && `     ) .`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-constant_lines'.
        rv_text = ``
      && `{{! Constants keep their lexical type; literal adds quotes and doubles embedded apostrophes. }}`
      && cl_abap_char_utilities=>newline
      && `{{#has_constants}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Maps constant value to function module parameters`
      && cl_abap_char_utilities=>newline
      && `{{#constants}} {{#via_line}}ls_{{/via_line}}{{parameter}}{{#component}}-{{component}}{{/component}} = {{value | literal}}.`
      && cl_abap_char_utilities=>newline
      && `{{/constants}}`
      && cl_abap_char_utilities=>newline
      && `{{/has_constants}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-create'.
        rv_text = ``
      && `{{! Create commits then reads back, and only nonempty keys enter the read request. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-declarations}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-request_banner}}* Get request input data`
      && cl_abap_char_utilities=>newline
      && ` io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-constant_lines}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Map request input fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-entry_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-call_function}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             - Read After Create -`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && ` CREATE OBJECT lo_tech_read_request_context.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Create key table for the read operation`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#keys}} ls_key-name = '{{field}}'.`
      && cl_abap_char_utilities=>newline
      && ` ls_key-value = {{source}}.`
      && cl_abap_char_utilities=>newline
      && ` IF ls_key-value IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   APPEND ls_key TO lt_keys.`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{/keys}}* Set into request context object the key table and the entity set name`
      && cl_abap_char_utilities=>newline
      && ` lo_tech_read_request_context->set_keys( EXPORTING  it_keys = lt_keys ).`
      && cl_abap_char_utilities=>newline
      && ` lv_entityset_name = io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && ` lo_tech_read_request_context->set_entityset_name( EXPORTING iv_entityset_name = lv_entityset_name ).`
      && cl_abap_char_utilities=>newline
      && ` lv_entity_name = io_tech_request_context->get_entity_type_name( ).`
      && cl_abap_char_utilities=>newline
      && ` lo_tech_read_request_context->set_entity_type_name( EXPORTING iv_entity_name = lv_entity_name ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Call read after create`
      && cl_abap_char_utilities=>newline
      && ` /iwbep/if_mgw_appl_srv_runtime~get_entity(`
      && cl_abap_char_utilities=>newline
      && `   EXPORTING`
      && cl_abap_char_utilities=>newline
      && `     iv_entity_name     = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `     iv_entity_set_name = iv_entity_set_name`
      && cl_abap_char_utilities=>newline
      && `     iv_source_name     = iv_source_name`
      && cl_abap_char_utilities=>newline
      && `     it_key_tab         = it_key_tab`
      && cl_abap_char_utilities=>newline
      && `     io_tech_request_context = lo_tech_read_request_context`
      && cl_abap_char_utilities=>newline
      && `     it_navigation_path = it_navigation_path`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING`
      && cl_abap_char_utilities=>newline
      && `     er_entity          = ls_entity ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Send the read response to the caller interface`
      && cl_abap_char_utilities=>newline
      && ` ASSIGN ls_entity->* TO <ls_data>.`
      && cl_abap_char_utilities=>newline
      && ` er_entity = <ls_data>.`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-declarations'.
        rv_text = ``
      && `{{! Editor sorting treats underscores as slashes; mapped parameters precede logs and constant-only parameters. Table DATA has an extra space; line DATA has two. }}`
      && cl_abap_char_utilities=>newline
      && `{{#declarations}} DATA {{name}}{{#table}} {{/table}} TYPE {{type}}.`
      && cl_abap_char_utilities=>newline
      && `{{/declarations}}{{#declarations}}{{#table}}{{#interface}} DATA ls_{{name}}  TYPE LINE OF {{type}}.`
      && cl_abap_char_utilities=>newline
      && `{{/interface}}{{^interface}} DATA ls_{{name}}  LIKE LINE OF {{name}}.`
      && cl_abap_char_utilities=>newline
      && `{{/interface}}{{/table}}{{/declarations}} DATA lv_rfc_name TYPE tfdir-funcname.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_destination TYPE rfcdest.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_subrc TYPE syst-subrc.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_exc_msg TYPE /iwbep/mgw_bop_rfc_excep_text.`
      && cl_abap_char_utilities=>newline
      && ` DATA lx_root TYPE REF TO cx_root.`
      && cl_abap_char_utilities=>newline
      && `{{#is_r}} DATA ls_converted_keys LIKE er_entity.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_source_entity_set_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && `{{/is_r}}{{#is_q}} DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.`
      && cl_abap_char_utilities=>newline
      && ` DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_filter_str TYPE string.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_paging TYPE /iwbep/s_mgw_paging.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_converted_keys LIKE LINE OF et_entityset.`
      && cl_abap_char_utilities=>newline
      && `{{#has_navigation}} DATA lv_source_entity_set_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && `{{/has_navigation}}{{#source_vars}} DATA {{variable}}_get_entityset TYPE LINE OF {{mpc}}=>tt_{{type_stem}}.`
      && cl_abap_char_utilities=>newline
      && `{{/source_vars}} DATA ls_filter TYPE /iwbep/s_mgw_select_option.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_filter_range TYPE /iwbep/s_cod_select_option.`
      && cl_abap_char_utilities=>newline
      && `{{#filters}} DATA lr_{{field}} LIKE RANGE OF ls_converted_keys-{{field}}.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_{{field}} LIKE LINE OF lr_{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/filters}}{{#out_table.name}} DATA ls_gw_{{out_table.name}} LIKE LINE OF et_entityset.`
      && cl_abap_char_utilities=>newline
      && `{{/out_table.name}} DATA lv_skip     TYPE int4.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_top      TYPE int4.`
      && cl_abap_char_utilities=>newline
      && `{{/is_q}}{{#is_c}} DATA ls_request_input_data TYPE {{type}}.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_entity TYPE REF TO data.`
      && cl_abap_char_utilities=>newline
      && ` DATA lo_tech_read_request_context TYPE REF TO /iwbep/cl_sb_gen_read_aftr_crt.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_key TYPE /iwbep/s_mgw_tech_pair.`
      && cl_abap_char_utilities=>newline
      && ` DATA lt_keys TYPE /iwbep/t_mgw_tech_pairs.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_entityset_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_entity_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && ` FIELD-SYMBOLS: <ls_data> TYPE ANY.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_converted_keys LIKE er_entity.`
      && cl_abap_char_utilities=>newline
      && `{{/is_c}}{{#is_u}} DATA ls_request_input_data TYPE {{type}}.`
      && cl_abap_char_utilities=>newline
      && ` DATA ls_converted_keys LIKE er_entity.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_source_entity_set_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && `{{/is_u}}{{#is_d}} DATA ls_converted_keys TYPE {{type}}.`
      && cl_abap_char_utilities=>newline
      && ` DATA lv_source_entity_set_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && `{{/is_d}} DATA lo_dp_facade TYPE REF TO /iwbep/if_mgw_dp_facade.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-delete'.
        rv_text = ``
      && `{{! Delete maps keys and constants, then commits without a response mapping. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-declarations}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-request_banner}}* Get key table information`
      && cl_abap_char_utilities=>newline
      && ` io_tech_request_context->get_converted_keys(`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING`
      && cl_abap_char_utilities=>newline
      && `     es_key_values  = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-constant_lines}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Maps key fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-key_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-call_function}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-entry_inputs'.
        rv_text = ``
      && `{{! Create includes key inputs; update excludes them. }}`
      && cl_abap_char_utilities=>newline
      && `{{#inputs}}{{#is_c}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_request_input_data-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/is_c}}{{^is_c}}{{^key}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_request_input_data-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/key}}`
      && cl_abap_char_utilities=>newline
      && `{{/is_c}}`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-error_handling'.
        rv_text = ``
      && `{{! SEGW repeats adjacent response and error banners; the exception node owns the fixed handling block. }}`
      && cl_abap_char_utilities=>newline
      && `{{#exceptions}}*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the RFC response to the caller interface - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Error and exception handling`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && ` IF lv_subrc <> 0.`
      && cl_abap_char_utilities=>newline
      && `* Execute the RFC exception handling process`
      && cl_abap_char_utilities=>newline
      && `   me->/iwbep/if_sb_dpc_comm_services~rfc_exception_handling(`
      && cl_abap_char_utilities=>newline
      && `     EXPORTING`
      && cl_abap_char_utilities=>newline
      && `       iv_subrc            = lv_subrc`
      && cl_abap_char_utilities=>newline
      && `       iv_exp_message_text = lv_exc_msg ).`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/exceptions}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-get_destination'.
        rv_text = ``
      && `{{! SEGW emits a leading blank before the destination banner and another before the call banner; standalone tags must preserve both. }}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Get RFC destination`
      && cl_abap_char_utilities=>newline
      && ` lo_dp_facade = /iwbep/if_mgw_conv_srv_runtime~get_dp_facade( ).`
      && cl_abap_char_utilities=>newline
      && ` lv_destination = /iwbep/cl_sb_gen_dpc_rt_util=>get_rfc_destination( io_dp_facade = lo_dp_facade ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Call RFC function module`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-key_inputs'.
        rv_text = ``
      && `{{! Only keys are copied for update and delete. }}`
      && cl_abap_char_utilities=>newline
      && `{{#inputs}}{{#key}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_converted_keys-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/key}}`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-query'.
        rv_text = ``
      && `{{! Query converts inside the nested select-option loop; ranges are ordered H L O S. Skip starts at skip plus one. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-declarations}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-request_banner}}* Get filter or select option information`
      && cl_abap_char_utilities=>newline
      && ` lo_filter = io_tech_request_context->get_filter( ).`
      && cl_abap_char_utilities=>newline
      && ` lt_filter_select_options = lo_filter->get_filter_select_options( ).`
      && cl_abap_char_utilities=>newline
      && ` lv_filter_str = lo_filter->get_filter_string( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Check if the supplied filter is supported by standard gateway runtime process`
      && cl_abap_char_utilities=>newline
      && ` IF  lv_filter_str            IS NOT INITIAL`
      && cl_abap_char_utilities=>newline
      && ` AND lt_filter_select_options IS INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   " If the string of the Filter System Query Option is not automatically converted into`
      && cl_abap_char_utilities=>newline
      && `   " filter option table (lt_filter_select_options), then the filtering combination is not supported`
      && cl_abap_char_utilities=>newline
      && `   " Log message in the application log`
      && cl_abap_char_utilities=>newline
      && `   me->/iwbep/if_sb_dpc_comm_services~log_message(`
      && cl_abap_char_utilities=>newline
      && `     EXPORTING`
      && cl_abap_char_utilities=>newline
      && `       iv_msg_type   = 'E'`
      && cl_abap_char_utilities=>newline
      && `       iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'`
      && cl_abap_char_utilities=>newline
      && `       iv_msg_number = 025 ).`
      && cl_abap_char_utilities=>newline
      && `   " Raise Exception`
      && cl_abap_char_utilities=>newline
      && `   RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception`
      && cl_abap_char_utilities=>newline
      && `     EXPORTING`
      && cl_abap_char_utilities=>newline
      && `       textid = /iwbep/cx_mgw_tech_exception=>internal_error.`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Get key table information`
      && cl_abap_char_utilities=>newline
      && ` io_tech_request_context->get_converted_source_keys(`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING`
      && cl_abap_char_utilities=>newline
      && `     es_key_values  = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` ls_paging-top = io_tech_request_context->get_top( ).`
      && cl_abap_char_utilities=>newline
      && ` ls_paging-skip = io_tech_request_context->get_skip( ).`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-constant_lines}}{{#has_navigation}}`
      && cl_abap_char_utilities=>newline
      && `* Maps key fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && ` IF it_key_tab IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && `{{#navigation}}   IF  lv_source_entity_set_name = '{{set}}'.`
      && cl_abap_char_utilities=>newline
      && `     " Convert keys to appropriate entity set structure`
      && cl_abap_char_utilities=>newline
      && `     io_tech_request_context->get_converted_source_keys(`
      && cl_abap_char_utilities=>newline
      && `       IMPORTING`
      && cl_abap_char_utilities=>newline
      && `         es_key_values  = {{variable}}_get_entityset ).`
      && cl_abap_char_utilities=>newline
      && `     {{parameter}}{{#component}}-{{component}}{{/component}} = {{variable}}_get_entityset-{{source_field}}.`
      && cl_abap_char_utilities=>newline
      && `   ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/navigation}} ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/has_navigation}}{{#has_filters}}`
      && cl_abap_char_utilities=>newline
      && ` IF it_filter_select_options IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `* Maps filter table lines to function module parameters`
      && cl_abap_char_utilities=>newline
      && `   LOOP AT lt_filter_select_options INTO ls_filter.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `     LOOP AT ls_filter-select_options INTO ls_filter_range.`
      && cl_abap_char_utilities=>newline
      && `       CASE ls_filter-property.`
      && cl_abap_char_utilities=>newline
      && `{{#filters}}         WHEN '{{field | upper}}'.              " Equivalent to '{{property}}' property in the service`
      && cl_abap_char_utilities=>newline
      && `           lo_filter->convert_select_option(`
      && cl_abap_char_utilities=>newline
      && `             EXPORTING`
      && cl_abap_char_utilities=>newline
      && `               is_select_option = ls_filter`
      && cl_abap_char_utilities=>newline
      && `             IMPORTING`
      && cl_abap_char_utilities=>newline
      && `               et_select_option = lr_{{field}} ).`
      && cl_abap_char_utilities=>newline
      && `{{#has_ranges}}           LOOP AT lr_{{field}} INTO ls_{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{#ranges}}             ls_{{parameter}}-{{component}} = ls_{{field}}-{{semantic}}.`
      && cl_abap_char_utilities=>newline
      && `{{/ranges}}             APPEND ls_{{parameter}} TO {{parameter}}.`
      && cl_abap_char_utilities=>newline
      && `           ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && `{{/has_ranges}}{{^has_ranges}}           READ TABLE lr_{{field}} INTO ls_{{field}} INDEX 1.`
      && cl_abap_char_utilities=>newline
      && `           IF sy-subrc = 0.`
      && cl_abap_char_utilities=>newline
      && `             {{parameter}}{{#component}}-{{component}}{{/component}} = ls_{{field}}-low.`
      && cl_abap_char_utilities=>newline
      && `           ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/has_ranges}}{{/filters}}         WHEN OTHERS.`
      && cl_abap_char_utilities=>newline
      && `           " Log message in the application log`
      && cl_abap_char_utilities=>newline
      && `           me->/iwbep/if_sb_dpc_comm_services~log_message(`
      && cl_abap_char_utilities=>newline
      && `             EXPORTING`
      && cl_abap_char_utilities=>newline
      && `               iv_msg_type   = 'E'`
      && cl_abap_char_utilities=>newline
      && `               iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'`
      && cl_abap_char_utilities=>newline
      && `               iv_msg_number = 020`
      && cl_abap_char_utilities=>newline
      && `               iv_msg_v1     = ls_filter-property ).`
      && cl_abap_char_utilities=>newline
      && `           " Raise Exception`
      && cl_abap_char_utilities=>newline
      && `           RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception`
      && cl_abap_char_utilities=>newline
      && `             EXPORTING`
      && cl_abap_char_utilities=>newline
      && `               textid = /iwbep/cx_mgw_tech_exception=>internal_error.`
      && cl_abap_char_utilities=>newline
      && `       ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `     ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `   ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/has_filters}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-call_function}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-error_handling}}{{> rfc-save_log}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             - Post Backend Call -`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `{{#out_table.name}} IF ls_paging-skip IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `*  If the Skip value was requested at runtime`
      && cl_abap_char_utilities=>newline
      && `*  the response table will provide backend entries from skip + 1, meaning start from skip +1`
      && cl_abap_char_utilities=>newline
      && `*  for example: skip=5 means to start get results from the 6th row`
      && cl_abap_char_utilities=>newline
      && `   lv_skip = ls_paging-skip + 1.`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `*  The Top value was requested at runtime but was not handled as part of the function interface`
      && cl_abap_char_utilities=>newline
      && ` IF  ls_paging-top <> 0`
      && cl_abap_char_utilities=>newline
      && ` AND lv_skip IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `*  if lv_skip > 0 retrieve the entries from lv_skip + Top - 1`
      && cl_abap_char_utilities=>newline
      && `*  for example: skip=5 and top=2 means to start get results from the 6th row and end in row number 7`
      && cl_abap_char_utilities=>newline
      && `   lv_top = ls_paging-top + lv_skip - 1.`
      && cl_abap_char_utilities=>newline
      && ` ELSEIF ls_paging-top <> 0`
      && cl_abap_char_utilities=>newline
      && ` AND    lv_skip IS INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   lv_top = ls_paging-top.`
      && cl_abap_char_utilities=>newline
      && ` ELSE.`
      && cl_abap_char_utilities=>newline
      && `   lv_top = LINES( {{out_table.name}} ).`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*  - Map properties from the backend to the Gateway output response table -`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` LOOP AT {{out_table.name}} INTO ls_{{out_table.name}}`
      && cl_abap_char_utilities=>newline
      && `*  Provide the response entries according to the Top and Skip parameters that were provided at runtime`
      && cl_abap_char_utilities=>newline
      && `      FROM lv_skip TO lv_top.`
      && cl_abap_char_utilities=>newline
      && `*  Only fields that were mapped will be delivered to the response table`
      && cl_abap_char_utilities=>newline
      && `{{#outputs}}   ls_gw_{{parameter}}-{{field}} = ls_{{parameter}}-{{component}}.`
      && cl_abap_char_utilities=>newline
      && `{{/outputs}}   APPEND ls_gw_{{out_table.name}} TO et_entityset.`
      && cl_abap_char_utilities=>newline
      && `   CLEAR ls_gw_{{out_table.name}}.`
      && cl_abap_char_utilities=>newline
      && ` ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && `{{/out_table.name}}  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-read'.
        rv_text = ``
      && `{{! Read maps every input, including nonkeys; table outputs read row one separately per mapping. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-declarations}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-request_banner}}* Get key table information - for direct call`
      && cl_abap_char_utilities=>newline
      && ` io_tech_request_context->get_converted_keys(`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING`
      && cl_abap_char_utilities=>newline
      && `     es_key_values = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-constant_lines}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Maps key fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && ` lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && `{{#navigation}} IF lv_source_entity_set_name = '{{set}}' AND`
      && cl_abap_char_utilities=>newline
      && `    lv_source_entity_set_name NE io_tech_request_context->get_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && `   io_tech_request_context->get_converted_source_keys(`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING es_key_values = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/navigation}}{{#inputs}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_converted_keys-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-call_function}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-error_handling}}{{> rfc-save_log}}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `*             - Post Backend Call -`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------------------*`
      && cl_abap_char_utilities=>newline
      && `* Map properties from the backend to the Gateway output response structure`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#outputs}}{{#table}} READ TABLE {{parameter}} INTO ls_{{parameter}} INDEX 1.`
      && cl_abap_char_utilities=>newline
      && ` er_entity-{{field}} = ls_{{parameter}}-{{component}}.`
      && cl_abap_char_utilities=>newline
      && `{{/table}}{{^table}} er_entity-{{field}} = {{parameter}}{{#component}}-{{component}}{{/component}}.`
      && cl_abap_char_utilities=>newline
      && `{{/table}}{{/outputs}}  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-request_banner'.
        rv_text = ``
      && `{{! Copied SEGW indentation, banners and blank lines are significant; request_banner is a distinct partial. }}`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the runtime request to the RFC - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Get all input information from the technical request context object`
      && cl_abap_char_utilities=>newline
      && `* Since DPC works with internal property names and runtime API interface holds external property names`
      && cl_abap_char_utilities=>newline
      && `* the process needs to get the all needed input information from the technical request context object`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-save_log'.
        rv_text = ``
      && `{{! The leading blank and log call exist only for a nonempty log attribute; its name is lower case. }}`
      && cl_abap_char_utilities=>newline
      && `{{#log}}{{#name}}`
      && cl_abap_char_utilities=>newline
      && ` IF {{name}} IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `   me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(`
      && cl_abap_char_utilities=>newline
      && `     EXPORTING`
      && cl_abap_char_utilities=>newline
      && `       iv_entity_type = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `       it_return      = {{name}}`
      && cl_abap_char_utilities=>newline
      && `       it_key_tab     = it_key_tab ).`
      && cl_abap_char_utilities=>newline
      && ` ENDIF.`
      && cl_abap_char_utilities=>newline
      && `{{/name}}`
      && cl_abap_char_utilities=>newline
      && `{{/log}}`
      && cl_abap_char_utilities=>newline.
      WHEN 'rfc-update'.
        rv_text = ``
      && `{{! Update takes keys from converted keys and excludes them from entry input mappings; it commits without output assignments. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-declarations}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-request_banner}}* Get request input data`
      && cl_abap_char_utilities=>newline
      && ` io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).`
      && cl_abap_char_utilities=>newline
      && `* Get key table information`
      && cl_abap_char_utilities=>newline
      && ` io_tech_request_context->get_converted_keys(`
      && cl_abap_char_utilities=>newline
      && `   IMPORTING`
      && cl_abap_char_utilities=>newline
      && `     es_key_values  = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-constant_lines}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Maps key fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-key_inputs}}* Map request input fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && `{{> rfc-entry_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-call_function}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}  endmethod.`
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
      WHEN 'shlp-interface'.
        rv_text = ``
      && `{{! Forwarding signature alignment is deliberately uneven: maxrows has two spaces and sort has one. }}`
      && cl_abap_char_utilities=>newline
      && `  method /IWBEP/IF_SB_GENDPC_SHLP_DATA~GET_SEARCH_HELP_VALUES.`
      && cl_abap_char_utilities=>newline
      && `* Call to Search Help run time mechanism to get values`
      && cl_abap_char_utilities=>newline
      && `  DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  CLEAR: et_return_list, es_message.`
      && cl_abap_char_utilities=>newline
      && `  lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      iv_shlp_name  = iv_shlp_name`
      && cl_abap_char_utilities=>newline
      && `      iv_maxrows  = iv_maxrows`
      && cl_abap_char_utilities=>newline
      && `      iv_sort = iv_sort`
      && cl_abap_char_utilities=>newline
      && `      iv_call_shlt_exit = iv_call_shlt_exit`
      && cl_abap_char_utilities=>newline
      && `      it_selopt = it_selopt`
      && cl_abap_char_utilities=>newline
      && `    IMPORTING`
      && cl_abap_char_utilities=>newline
      && `      et_return_list = et_return_list`
      && cl_abap_char_utilities=>newline
      && `      es_message = es_message ).`
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'shlp-output'.
        rv_text = ``
      && `{{! Each returned field emits a WHEN and assignment; result components use the final path segment, while input selection names keep the full upper-case path. }}`
      && cl_abap_char_utilities=>newline
      && `    WHEN '{{component | upper}}'.`
      && cl_abap_char_utilities=>newline
      && `      {{target}}-{{field}} = ls_result_list-field_value.`
      && cl_abap_char_utilities=>newline.
      WHEN 'shlp-query'.
        rv_text = ``
      && `{{! Query uses is_paging for max hits despite reading ls_paging; preserve responce spelling and unindented DATA. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.`
      && cl_abap_char_utilities=>newline
      && `DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_filter_str TYPE string.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_max_hits TYPE i.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_paging TYPE /iwbep/s_mgw_paging.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_converted_keys LIKE LINE OF et_entityset.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_message TYPE bapiret2.`
      && cl_abap_char_utilities=>newline
      && `DATA lt_selopt TYPE ddshselops.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_selopt LIKE LINE OF lt_selopt.`
      && cl_abap_char_utilities=>newline
      && `{{#has_inputs}}DATA ls_filter TYPE /iwbep/s_mgw_select_option.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_filter_range TYPE /iwbep/s_cod_select_option.`
      && cl_abap_char_utilities=>newline
      && `{{/has_inputs}}{{#inputs}}DATA lr_{{field}} LIKE RANGE OF ls_converted_keys-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_{{field}} LIKE LINE OF lr_{{field}}.`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_next TYPE i VALUE 1.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_entityset LIKE LINE OF et_entityset.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_result_list_next LIKE LINE OF lt_result_list.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_result_list LIKE LINE OF lt_result_list.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the runtime request to the Search Help select option - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Get all input information from the technical request context object`
      && cl_abap_char_utilities=>newline
      && `* Since DPC works with internal property names and runtime API interface holds external property names`
      && cl_abap_char_utilities=>newline
      && `* the process needs to get the all needed input information from the technical request context object`
      && cl_abap_char_utilities=>newline
      && `* Get filter or select option information`
      && cl_abap_char_utilities=>newline
      && `lo_filter = io_tech_request_context->get_filter( ).`
      && cl_abap_char_utilities=>newline
      && `lt_filter_select_options = lo_filter->get_filter_select_options( ).`
      && cl_abap_char_utilities=>newline
      && `lv_filter_str = lo_filter->get_filter_string( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Check if the supplied filter is supported by standard gateway runtime process`
      && cl_abap_char_utilities=>newline
      && `IF  lv_filter_str            IS NOT INITIAL`
      && cl_abap_char_utilities=>newline
      && `AND lt_filter_select_options IS INITIAL.`
      && cl_abap_char_utilities=>newline
      && `  " If the string of the Filter System Query Option is not automatically converted into`
      && cl_abap_char_utilities=>newline
      && `  " filter option table (lt_filter_select_options), then the filtering combination is not supported`
      && cl_abap_char_utilities=>newline
      && `  " Log message in the application log`
      && cl_abap_char_utilities=>newline
      && `  me->/iwbep/if_sb_dpc_comm_services~log_message(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      iv_msg_type   = 'E'`
      && cl_abap_char_utilities=>newline
      && `      iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'`
      && cl_abap_char_utilities=>newline
      && `      iv_msg_number = 025 ).`
      && cl_abap_char_utilities=>newline
      && `  " Raise Exception`
      && cl_abap_char_utilities=>newline
      && `  RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      textid = /iwbep/cx_mgw_tech_exception=>internal_error.`
      && cl_abap_char_utilities=>newline
      && `ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Get key table information`
      && cl_abap_char_utilities=>newline
      && `io_tech_request_context->get_converted_source_keys(`
      && cl_abap_char_utilities=>newline
      && `  IMPORTING`
      && cl_abap_char_utilities=>newline
      && `    es_key_values  = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `ls_paging-top = io_tech_request_context->get_top( ).`
      && cl_abap_char_utilities=>newline
      && `ls_paging-skip = io_tech_request_context->get_skip( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `" Calculate the number of max hits to be fetched from the function module`
      && cl_abap_char_utilities=>newline
      && `" The lv_max_hits value is a summary of the Top and Skip values`
      && cl_abap_char_utilities=>newline
      && `IF ls_paging-top > 0.`
      && cl_abap_char_utilities=>newline
      && `  lv_max_hits = is_paging-top + is_paging-skip.`
      && cl_abap_char_utilities=>newline
      && `ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#has_inputs}}* Maps filter table lines to the Search Help select option table`
      && cl_abap_char_utilities=>newline
      && `LOOP AT lt_filter_select_options INTO ls_filter.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  CASE ls_filter-property.`
      && cl_abap_char_utilities=>newline
      && `{{#inputs}}    WHEN '{{field | upper}}'.              " Equivalent to '{{property}}' property in the service`
      && cl_abap_char_utilities=>newline
      && `      lo_filter->convert_select_option(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          is_select_option = ls_filter`
      && cl_abap_char_utilities=>newline
      && `        IMPORTING`
      && cl_abap_char_utilities=>newline
      && `          et_select_option = lr_{{field}} ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `      LOOP AT lr_{{field}} INTO ls_{{field}}.`
      && cl_abap_char_utilities=>newline
      && `        ls_selopt-high = ls_{{field}}-high.`
      && cl_abap_char_utilities=>newline
      && `        ls_selopt-low = ls_{{field}}-low.`
      && cl_abap_char_utilities=>newline
      && `        ls_selopt-option = ls_{{field}}-option.`
      && cl_abap_char_utilities=>newline
      && `        ls_selopt-sign = ls_{{field}}-sign.`
      && cl_abap_char_utilities=>newline
      && `        ls_selopt-shlpfield = '{{parameter | upper}}'.`
      && cl_abap_char_utilities=>newline
      && `{{#module}}        ls_selopt-shlpname = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}        APPEND ls_selopt TO lt_selopt.`
      && cl_abap_char_utilities=>newline
      && `        CLEAR ls_selopt.`
      && cl_abap_char_utilities=>newline
      && `      ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `    WHEN OTHERS.`
      && cl_abap_char_utilities=>newline
      && `      " Log message in the application log`
      && cl_abap_char_utilities=>newline
      && `      me->/iwbep/if_sb_dpc_comm_services~log_message(`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          iv_msg_type   = 'E'`
      && cl_abap_char_utilities=>newline
      && `          iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'`
      && cl_abap_char_utilities=>newline
      && `          iv_msg_number = 020`
      && cl_abap_char_utilities=>newline
      && `          iv_msg_v1     = ls_filter-property ).`
      && cl_abap_char_utilities=>newline
      && `      " Raise Exception`
      && cl_abap_char_utilities=>newline
      && `      RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception`
      && cl_abap_char_utilities=>newline
      && `        EXPORTING`
      && cl_abap_char_utilities=>newline
      && `          textid = /iwbep/cx_mgw_tech_exception=>internal_error.`
      && cl_abap_char_utilities=>newline
      && `  ENDCASE.`
      && cl_abap_char_utilities=>newline
      && `ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && `{{/has_inputs}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Call to Search Help get values mechanism`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Get search help values`
      && cl_abap_char_utilities=>newline
      && `me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(`
      && cl_abap_char_utilities=>newline
      && `  EXPORTING`
      && cl_abap_char_utilities=>newline
      && `{{#module}}    iv_shlp_name = '{{name}}'`
      && cl_abap_char_utilities=>newline
      && `{{/module}}    iv_maxrows = lv_max_hits`
      && cl_abap_char_utilities=>newline
      && `    iv_sort = 'X'`
      && cl_abap_char_utilities=>newline
      && `    iv_call_shlt_exit = 'X'`
      && cl_abap_char_utilities=>newline
      && `    it_selopt = lt_selopt`
      && cl_abap_char_utilities=>newline
      && `  IMPORTING`
      && cl_abap_char_utilities=>newline
      && `    et_return_list = lt_result_list`
      && cl_abap_char_utilities=>newline
      && `    es_message = ls_message ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the Search Help returned results to the caller interface - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `IF ls_message IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `* Call RFC call exception handling`
      && cl_abap_char_utilities=>newline
      && `  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      is_return      = ls_message`
      && cl_abap_char_utilities=>newline
      && `      iv_entity_type = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `      it_key_tab     = it_key_tab ).`
      && cl_abap_char_utilities=>newline
      && `ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CLEAR et_entityset.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `LOOP AT lt_result_list INTO ls_result_list`
      && cl_abap_char_utilities=>newline
      && `  WHERE record_number > ls_paging-skip.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  " Move SH results to GW request responce table`
      && cl_abap_char_utilities=>newline
      && `  lv_next = sy-tabix + 1. " next loop iteration`
      && cl_abap_char_utilities=>newline
      && `  CASE ls_result_list-field_name.`
      && cl_abap_char_utilities=>newline
      && `{{#outputs}}{{> shlp-output target=result_target}}{{/outputs}}  ENDCASE.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  " Check if the next line in the result list is a new record`
      && cl_abap_char_utilities=>newline
      && `  READ TABLE lt_result_list INTO ls_result_list_next INDEX lv_next.`
      && cl_abap_char_utilities=>newline
      && `  IF sy-subrc <> 0`
      && cl_abap_char_utilities=>newline
      && `  OR ls_result_list-record_number <> ls_result_list_next-record_number.`
      && cl_abap_char_utilities=>newline
      && `    " Save the collected SH result in the GW request table`
      && cl_abap_char_utilities=>newline
      && `    APPEND ls_entityset TO et_entityset.`
      && cl_abap_char_utilities=>newline
      && `    CLEAR: ls_result_list_next, ls_entityset.`
      && cl_abap_char_utilities=>newline
      && `  ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `ENDLOOP.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  endmethod.`
      && cl_abap_char_utilities=>newline.
      WHEN 'shlp-read'.
        rv_text = ``
      && `{{! Read inserts a blank between selection parameters, fixes max hits to one, and maps all inputs as EQ. }}`
      && cl_abap_char_utilities=>newline
      && `  method {{method}}.`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Data declaration`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `DATA lv_max_hits TYPE i VALUE 1.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_converted_keys LIKE er_entity.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_message TYPE bapiret2.`
      && cl_abap_char_utilities=>newline
      && `DATA lt_selopt TYPE ddshselops.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_selopt LIKE LINE OF lt_selopt.`
      && cl_abap_char_utilities=>newline
      && `DATA lv_source_entity_set_name TYPE string.`
      && cl_abap_char_utilities=>newline
      && `DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.`
      && cl_abap_char_utilities=>newline
      && `DATA ls_result_list LIKE LINE OF lt_result_list.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the runtime request to the Search Help select option - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Get all input information from the technical request context object`
      && cl_abap_char_utilities=>newline
      && `* Since DPC works with internal property names and runtime API interface holds external property names`
      && cl_abap_char_utilities=>newline
      && `* the process needs to get the all needed input information from the technical request context object`
      && cl_abap_char_utilities=>newline
      && `* Get key table information - for direct call`
      && cl_abap_char_utilities=>newline
      && `io_tech_request_context->get_converted_keys(`
      && cl_abap_char_utilities=>newline
      && `  IMPORTING`
      && cl_abap_char_utilities=>newline
      && `    es_key_values = ls_converted_keys ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `* Maps key fields to function module parameters`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `{{#inputs}}{{^@first}}`
      && cl_abap_char_utilities=>newline
      && `{{/@first}}ls_selopt-sign = 'I'.`
      && cl_abap_char_utilities=>newline
      && `ls_selopt-option = 'EQ'.`
      && cl_abap_char_utilities=>newline
      && `ls_selopt-low = ls_converted_keys-{{field}}.`
      && cl_abap_char_utilities=>newline
      && `ls_selopt-shlpfield = '{{parameter | upper}}'.`
      && cl_abap_char_utilities=>newline
      && `{{#module}}ls_selopt-shlpname = '{{name}}'.`
      && cl_abap_char_utilities=>newline
      && `{{/module}}APPEND ls_selopt TO lt_selopt.`
      && cl_abap_char_utilities=>newline
      && `CLEAR ls_selopt.`
      && cl_abap_char_utilities=>newline
      && `{{/inputs}}`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Call to Search Help get values mechanism`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `* Get search help values`
      && cl_abap_char_utilities=>newline
      && `me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(`
      && cl_abap_char_utilities=>newline
      && `  EXPORTING`
      && cl_abap_char_utilities=>newline
      && `{{#module}}    iv_shlp_name = '{{name}}'`
      && cl_abap_char_utilities=>newline
      && `{{/module}}    iv_maxrows = lv_max_hits`
      && cl_abap_char_utilities=>newline
      && `    iv_sort = 'X'`
      && cl_abap_char_utilities=>newline
      && `    iv_call_shlt_exit = 'X'`
      && cl_abap_char_utilities=>newline
      && `    it_selopt = lt_selopt`
      && cl_abap_char_utilities=>newline
      && `  IMPORTING`
      && cl_abap_char_utilities=>newline
      && `    et_return_list = lt_result_list`
      && cl_abap_char_utilities=>newline
      && `    es_message = ls_message ).`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `*  Map the Search Help returned results to the caller interface - Only mapped attributes`
      && cl_abap_char_utilities=>newline
      && `*-------------------------------------------------------------`
      && cl_abap_char_utilities=>newline
      && `IF ls_message IS NOT INITIAL.`
      && cl_abap_char_utilities=>newline
      && `* Call RFC call exception handling`
      && cl_abap_char_utilities=>newline
      && `  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(`
      && cl_abap_char_utilities=>newline
      && `    EXPORTING`
      && cl_abap_char_utilities=>newline
      && `      is_return      = ls_message`
      && cl_abap_char_utilities=>newline
      && `      iv_entity_type = iv_entity_name`
      && cl_abap_char_utilities=>newline
      && `      it_key_tab     = it_key_tab ).`
      && cl_abap_char_utilities=>newline
      && `ENDIF.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `CLEAR er_entity.`
      && cl_abap_char_utilities=>newline
      && `LOOP AT lt_result_list INTO ls_result_list.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `  " Move SH results to GW request responce table`
      && cl_abap_char_utilities=>newline
      && `  CASE ls_result_list-field_name.`
      && cl_abap_char_utilities=>newline
      && `{{#outputs}}{{> shlp-output target=result_target}}{{/outputs}}  ENDCASE.`
      && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline
      && `ENDLOOP.`
      && cl_abap_char_utilities=>newline
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
    APPEND 'rfc-append_constant_lines' TO rt_names.
    APPEND 'rfc-call_function' TO rt_names.
    APPEND 'rfc-commit' TO rt_names.
    APPEND 'rfc-constant_lines' TO rt_names.
    APPEND 'rfc-create' TO rt_names.
    APPEND 'rfc-declarations' TO rt_names.
    APPEND 'rfc-delete' TO rt_names.
    APPEND 'rfc-entry_inputs' TO rt_names.
    APPEND 'rfc-error_handling' TO rt_names.
    APPEND 'rfc-get_destination' TO rt_names.
    APPEND 'rfc-key_inputs' TO rt_names.
    APPEND 'rfc-query' TO rt_names.
    APPEND 'rfc-read' TO rt_names.
    APPEND 'rfc-request_banner' TO rt_names.
    APPEND 'rfc-save_log' TO rt_names.
    APPEND 'rfc-update' TO rt_names.
    APPEND 'sadl_create_deep_entity' TO rt_names.
    APPEND 'sadl_execute_action' TO rt_names.
    APPEND 'sadl_get_dpc' TO rt_names.
    APPEND 'sadl_get_is_condi_imple_for_action' TO rt_names.
    APPEND 'sadl_get_is_conditional_implemented' TO rt_names.
    APPEND 'sadl_patch_entity' TO rt_names.
    APPEND 'sadl_set_extension_mapping' TO rt_names.
    APPEND 'sadl_set_query_options' TO rt_names.
    APPEND 'shlp-interface' TO rt_names.
    APPEND 'shlp-output' TO rt_names.
    APPEND 'shlp-query' TO rt_names.
    APPEND 'shlp-read' TO rt_names.
    APPEND 'signature_c' TO rt_names.
    APPEND 'signature_d' TO rt_names.
    APPEND 'signature_q' TO rt_names.
    APPEND 'signature_r' TO rt_names.
    APPEND 'signature_u' TO rt_names.
    APPEND 'stub' TO rt_names.
  ENDMETHOD.
ENDCLASS.
