{{! Delete maps keys and constants, then commits without a response mapping. }}
  method {{method}}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
{{> rfc-declarations}}

{{> rfc-request_banner}}* Get key table information
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).
{{> rfc-constant_lines}}

* Maps key fields to function module parameters

{{> rfc-key_inputs}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.
{{/module}}

{{> rfc-call_function}}

{{> rfc-error_handling}}{{> rfc-save_log}}{{> rfc-commit}}  endmethod.
