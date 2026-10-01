  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITYSET.
*&----------------------------------------------------------------------------------------------*
*&  Include           /IWBEP/DPC_TMP_ENTITYSET_BASE
*&* This class has been generated on {{generated_on}} in client {{client}}
*&*
*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING
*&*   If you want to change the DPC implementation, use the
*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}
*&-----------------------------------------------------------------------------------------------*
{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>tt_{{type_stem_lower}}.
{{/cases}} DATA lv_entityset_name TYPE string.

lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

CASE lv_entityset_name.
{{#cases}}
*-------------------------------------------------------------------------*
*             EntitySet -  {{set_name}}
*-------------------------------------------------------------------------*
   WHEN '{{set_name}}'.
*     Call the entity set generated method
      {{method_lower}}(
        EXPORTING
         iv_entity_name = iv_entity_name
         iv_entity_set_name = iv_entity_set_name
         iv_source_name = iv_source_name
         it_filter_select_options = it_filter_select_options
         it_order = it_order
         is_paging = is_paging
         it_navigation_path = it_navigation_path
         it_key_tab = it_key_tab
         iv_filter_string = iv_filter_string
         iv_search_string = iv_search_string
         io_tech_request_context = io_tech_request_context
       IMPORTING
         et_entityset = {{method_lower}}
         es_response_context = es_response_context
       ).
*     Send specific entity data to the caller interface
      copy_data_to_ref(
        EXPORTING
          is_data = {{method_lower}}
        CHANGING
          cr_data = er_entityset
      ).

{{/cases}}
    WHEN OTHERS.
      super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(
        EXPORTING
          iv_entity_name = iv_entity_name
          iv_entity_set_name = iv_entity_set_name
          iv_source_name = iv_source_name
          it_filter_select_options = it_filter_select_options
          it_order = it_order
          is_paging = is_paging
          it_navigation_path = it_navigation_path
          it_key_tab = it_key_tab
          iv_filter_string = iv_filter_string
          iv_search_string = iv_search_string
          io_tech_request_context = io_tech_request_context
       IMPORTING
         er_entityset = er_entityset ).
 ENDCASE.
  endmethod.
