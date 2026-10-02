{{! Editor sorting treats underscores as slashes; mapped parameters precede logs and constant-only parameters. Table DATA has an extra space; line DATA has two. }}
{{#declarations}} DATA {{name}}{{#table}} {{/table}} TYPE {{type}}.
{{/declarations}}{{#declarations}}{{#table}}{{#interface}} DATA ls_{{name}}  TYPE LINE OF {{type}}.
{{/interface}}{{^interface}} DATA ls_{{name}}  LIKE LINE OF {{name}}.
{{/interface}}{{/table}}{{/declarations}} DATA lv_rfc_name TYPE tfdir-funcname.
 DATA lv_destination TYPE rfcdest.
 DATA lv_subrc TYPE syst-subrc.
 DATA lv_exc_msg TYPE /iwbep/mgw_bop_rfc_excep_text.
 DATA lx_root TYPE REF TO cx_root.
{{#is_r}} DATA ls_converted_keys LIKE er_entity.
 DATA lv_source_entity_set_name TYPE string.
{{/is_r}}{{#is_q}} DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.
 DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.
 DATA lv_filter_str TYPE string.
 DATA ls_paging TYPE /iwbep/s_mgw_paging.
 DATA ls_converted_keys LIKE LINE OF et_entityset.
{{#has_navigation}} DATA lv_source_entity_set_name TYPE string.
{{/has_navigation}}{{#source_vars}} DATA {{variable}}_get_entityset TYPE LINE OF {{mpc}}=>tt_{{type_stem}}.
{{/source_vars}} DATA ls_filter TYPE /iwbep/s_mgw_select_option.
 DATA ls_filter_range TYPE /iwbep/s_cod_select_option.
{{#filters}} DATA lr_{{field}} LIKE RANGE OF ls_converted_keys-{{field}}.
 DATA ls_{{field}} LIKE LINE OF lr_{{field}}.
{{/filters}}{{#out_table.name}} DATA ls_gw_{{out_table.name}} LIKE LINE OF et_entityset.
{{/out_table.name}} DATA lv_skip     TYPE int4.
 DATA lv_top      TYPE int4.
{{/is_q}}{{#is_c}} DATA ls_request_input_data TYPE {{type}}.
 DATA ls_entity TYPE REF TO data.
 DATA lo_tech_read_request_context TYPE REF TO /iwbep/cl_sb_gen_read_aftr_crt.
 DATA ls_key TYPE /iwbep/s_mgw_tech_pair.
 DATA lt_keys TYPE /iwbep/t_mgw_tech_pairs.
 DATA lv_entityset_name TYPE string.
 DATA lv_entity_name TYPE string.
 FIELD-SYMBOLS: <ls_data> TYPE ANY.
 DATA ls_converted_keys LIKE er_entity.
{{/is_c}}{{#is_u}} DATA ls_request_input_data TYPE {{type}}.
 DATA ls_converted_keys LIKE er_entity.
 DATA lv_source_entity_set_name TYPE string.
{{/is_u}}{{#is_d}} DATA ls_converted_keys TYPE {{type}}.
 DATA lv_source_entity_set_name TYPE string.
{{/is_d}} DATA lo_dp_facade TYPE REF TO /iwbep/if_mgw_dp_facade.
