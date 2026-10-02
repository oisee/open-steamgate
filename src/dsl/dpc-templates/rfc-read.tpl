{{! Read maps every input, including nonkeys; table outputs read row one separately per mapping. }}
  method {{method}}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
{{> rfc-declarations}}

{{> rfc-request_banner}}* Get key table information - for direct call
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values = ls_converted_keys ).
{{> rfc-constant_lines}}

* Maps key fields to function module parameters

 lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).
{{#navigation}} IF lv_source_entity_set_name = '{{set}}' AND
    lv_source_entity_set_name NE io_tech_request_context->get_entity_set_name( ).
   io_tech_request_context->get_converted_source_keys(
   IMPORTING es_key_values = ls_converted_keys ).
 ENDIF.
{{/navigation}}{{#inputs}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_converted_keys-{{field}}.
{{/inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.
{{/module}}

{{> rfc-call_function}}

{{> rfc-error_handling}}{{> rfc-save_log}}
*-------------------------------------------------------------------------*
*             - Post Backend Call -
*-------------------------------------------------------------------------*
* Map properties from the backend to the Gateway output response structure

{{#outputs}}{{#table}} READ TABLE {{parameter}} INTO ls_{{parameter}} INDEX 1.
 er_entity-{{field}} = ls_{{parameter}}-{{component}}.
{{/table}}{{^table}} er_entity-{{field}} = {{parameter}}{{#component}}-{{component}}{{/component}}.
{{/table}}{{/outputs}}  endmethod.
