{{! GET_ENTITY's banner has 95 leading dashes and two spaces before 'on'. }}
  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITY.
*&-----------------------------------------------------------------------------------------------*
*&  Include           /IWBEP/DPC_TEMP_GETENTITY_BASE
*&* This class has been generated  on {{generated_on}} in client {{client}}
*&*
*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING
*&*   If you want to change the DPC implementation, use the
*&*   generated methods inside the DPC provider subclass - {{dpc_ext}}
*&-----------------------------------------------------------------------------------------------*

{{#cases}} DATA {{method_lower}} TYPE {{mpc_lower}}=>ts_{{type_stem_lower}}.
{{/cases}} DATA lv_entityset_name TYPE string.
 DATA lr_entity TYPE REF TO data.       "#EC NEEDED

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
                         it_key_tab         = it_key_tab
                         it_navigation_path = it_navigation_path
                         io_tech_request_context = io_tech_request_context
             {{tab}} IMPORTING er_entity          = {{method_lower}}
                         es_response_context = es_response_context
          ).

        IF {{method_lower}} IS NOT INITIAL.
*     Send specific entity data to the caller interface
          copy_data_to_ref(
            EXPORTING
              is_data = {{method_lower}}
            CHANGING
              cr_data = er_entity
          ).
        ELSE.
*         In case of initial values - unbind the entity reference
          er_entity = lr_entity.
        ENDIF.
{{/cases}}

      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~get_entity(
           EXPORTING
             iv_entity_name = iv_entity_name
             iv_entity_set_name = iv_entity_set_name
             iv_source_name = iv_source_name
             it_key_tab = it_key_tab
             it_navigation_path = it_navigation_path
          IMPORTING
            er_entity = er_entity
    ).
 ENDCASE.
  endmethod.
