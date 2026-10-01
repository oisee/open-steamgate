{{! SEGW keeps redefinitions in Q R U C D order, then sorts implementation names. }}
class {{dpc}} definition
  public
  inheriting from /IWBEP/CL_MGW_PUSH_ABS_DATA
  abstract
  create public .

public section.

  interfaces /IWBEP/IF_SB_DPC_COMM_SERVICES .
{{#has_shlp}}  interfaces /IWBEP/IF_SB_GENDPC_SHLP_DATA .
{{/has_shlp}}  interfaces /IWBEP/IF_SB_GEN_DPC_INJECTION .
{{#has_sadl}}  interfaces IF_SADL_GW_DPC_UTIL .
  interfaces IF_SADL_GW_EXTENSION_CONTROL .
  interfaces IF_SADL_GW_QUERY_CONTROL .
{{/has_sadl}}

{{#redefs}}  methods /IWBEP/IF_MGW_APPL_SRV_RUNTIME~{{name}}
    redefinition .
{{/redefs}}protected section.

  data mo_injection type ref to /IWBEP/IF_SB_GEN_DPC_INJECTION .

{{#declarations}}
{{#is_c}}{{> signature_c}}{{/is_c}}{{#is_d}}{{> signature_d}}{{/is_d}}{{#is_r}}{{> signature_r}}{{/is_r}}{{#is_q}}{{> signature_q}}{{/is_q}}{{#is_u}}{{> signature_u}}{{/is_u}}{{/declarations}}
  methods CHECK_SUBSCRIPTION_AUTHORITY
    redefinition .
private section.
ENDCLASS.



CLASS {{dpc}} IMPLEMENTATION.

{{! The model's separator gives one newline before the first body and two between bodies. }}
{{#impls}}{{separator}}{{#dispatch_c}}{{> dispatch_c}}{{/dispatch_c}}{{#dispatch_d}}{{> dispatch_d}}{{/dispatch_d}}{{#dispatch_r}}{{> dispatch_r}}{{/dispatch_r}}{{#dispatch_q}}{{> dispatch_q}}{{/dispatch_q}}{{#dispatch_u}}{{> dispatch_u}}{{/dispatch_u}}{{#fixed_commit_work}}{{> fixed_commit_work}}{{/fixed_commit_work}}{{#fixed_get_generation_strategy}}{{> fixed_get_generation_strategy}}{{/fixed_get_generation_strategy}}{{#fixed_log_message}}{{> fixed_log_message}}{{/fixed_log_message}}{{#fixed_rfc_exception_handling}}{{> fixed_rfc_exception_handling}}{{/fixed_rfc_exception_handling}}{{#fixed_rfc_save_log}}{{> fixed_rfc_save_log}}{{/fixed_rfc_save_log}}{{#fixed_set_injection}}{{> fixed_set_injection}}{{/fixed_set_injection}}{{#fixed_check_subscription_authority}}{{> fixed_check_subscription_authority}}{{/fixed_check_subscription_authority}}{{#stub}}{{> stub}}{{/stub}}{{#odc_q}}{{> odc_q}}{{/odc_q}}{{#odc_r}}{{> odc_r}}{{/odc_r}}{{#delegate_c}}{{> delegate_c}}{{/delegate_c}}{{#delegate_d}}{{> delegate_d}}{{/delegate_d}}{{#delegate_r}}{{> delegate_r}}{{/delegate_r}}{{#delegate_q}}{{> delegate_q}}{{/delegate_q}}{{#delegate_u}}{{> delegate_u}}{{/delegate_u}}{{#sadl_create_deep_entity}}{{> sadl_create_deep_entity}}{{/sadl_create_deep_entity}}{{#sadl_execute_action}}{{> sadl_execute_action}}{{/sadl_execute_action}}{{#sadl_get_is_conditional_implemented}}{{> sadl_get_is_conditional_implemented}}{{/sadl_get_is_conditional_implemented}}{{#sadl_get_is_condi_imple_for_action}}{{> sadl_get_is_condi_imple_for_action}}{{/sadl_get_is_condi_imple_for_action}}{{#sadl_patch_entity}}{{> sadl_patch_entity}}{{/sadl_patch_entity}}{{#sadl_get_dpc}}{{> sadl_get_dpc}}{{/sadl_get_dpc}}{{#sadl_set_extension_mapping}}{{> sadl_set_extension_mapping}}{{/sadl_set_extension_mapping}}{{#sadl_set_query_options}}{{> sadl_set_query_options}}{{/sadl_set_query_options}}{{#opaque}}{{{opaque}}}{{/opaque}}{{/impls}}ENDCLASS.
