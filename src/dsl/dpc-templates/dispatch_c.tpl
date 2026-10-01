{{! SEGW writes a literal tab before IMPORTING; the operation model supplies it. }}
  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_ENTITY.
*&----------------------------------------------------------------------------------------------*
*&  Include           /IWBEP/DPC_TEMP_CRT_ENTITY_BASE
*&* This class has been generated on {{generated_on}} in client {{client}}
*&*
*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING
*&*   If you want to change the DPC implementation, use the
*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}
*&-----------------------------------------------------------------------------------------------*

{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>ts_{{type_stem_lower}}.
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
         EXPORTING iv_entity_name     = iv_entity_name
                   iv_entity_set_name = iv_entity_set_name
                   iv_source_name     = iv_source_name
                   io_data_provider   = io_data_provider
                   it_key_tab         = it_key_tab
                   it_navigation_path = it_navigation_path
                   io_tech_request_context = io_tech_request_context
       {{tab}} IMPORTING er_entity          = {{method_lower}}
    ).
*     Send specific entity data to the caller interfaces
    copy_data_to_ref(
      EXPORTING
        is_data = {{method_lower}}
      CHANGING
        cr_data = er_entity
   ).

{{/cases}}
  when others.
    super->/iwbep/if_mgw_appl_srv_runtime~create_entity(
       EXPORTING
         iv_entity_name = iv_entity_name
         iv_entity_set_name = iv_entity_set_name
         iv_source_name = iv_source_name
         io_data_provider   = io_data_provider
         it_key_tab = it_key_tab
         it_navigation_path = it_navigation_path
      IMPORTING
        er_entity = er_entity
  ).
ENDCASE.
  endmethod.
