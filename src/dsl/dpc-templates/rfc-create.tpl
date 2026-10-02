{{! Create commits then reads back, and only nonempty keys enter the read request. }}
  method {{method}}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
{{> rfc-declarations}}

{{> rfc-request_banner}}* Get request input data
 io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).
{{> rfc-constant_lines}}

* Map request input fields to function module parameters
{{> rfc-entry_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.
{{/module}}

{{> rfc-call_function}}

{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}*-------------------------------------------------------------------------*
*             - Read After Create -
*-------------------------------------------------------------------------*
 CREATE OBJECT lo_tech_read_request_context.

* Create key table for the read operation

{{#keys}} ls_key-name = '{{field}}'.
 ls_key-value = {{source}}.
 IF ls_key-value IS NOT INITIAL.
   APPEND ls_key TO lt_keys.
 ENDIF.

{{/keys}}* Set into request context object the key table and the entity set name
 lo_tech_read_request_context->set_keys( EXPORTING  it_keys = lt_keys ).
 lv_entityset_name = io_tech_request_context->get_entity_set_name( ).
 lo_tech_read_request_context->set_entityset_name( EXPORTING iv_entityset_name = lv_entityset_name ).
 lv_entity_name = io_tech_request_context->get_entity_type_name( ).
 lo_tech_read_request_context->set_entity_type_name( EXPORTING iv_entity_name = lv_entity_name ).

* Call read after create
 /iwbep/if_mgw_appl_srv_runtime~get_entity(
   EXPORTING
     iv_entity_name     = iv_entity_name
     iv_entity_set_name = iv_entity_set_name
     iv_source_name     = iv_source_name
     it_key_tab         = it_key_tab
     io_tech_request_context = lo_tech_read_request_context
     it_navigation_path = it_navigation_path
   IMPORTING
     er_entity          = ls_entity ).

* Send the read response to the caller interface
 ASSIGN ls_entity->* TO <ls_data>.
 er_entity = <ls_data>.
  endmethod.
