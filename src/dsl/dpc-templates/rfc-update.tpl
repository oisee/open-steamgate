{{! Update takes keys from converted keys and excludes them from entry input mappings; it commits without output assignments. }}
  method {{method}}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
{{> rfc-declarations}}

{{> rfc-request_banner}}* Get request input data
 io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).
* Get key table information
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).
{{> rfc-constant_lines}}

* Maps key fields to function module parameters

{{> rfc-key_inputs}}* Map request input fields to function module parameters
{{> rfc-entry_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.
{{/module}}

{{> rfc-call_function}}

{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}  endmethod.
