  method {{method}}.
{{#missing_rfc}}* Mapped to {{function_name}}: the function group was not available when this class was generated
{{/missing_rfc}}  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
    EXPORTING
      textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
      method = '{{method}}'.
  endmethod.
