{{! SEGW lists SADL data sources forward and result structures in reverse set order. }}
  method IF_SADL_GW_DPC_UTIL~GET_DPC.
{{#refs}}    TYPES ty_{{binding}}_{{index}} TYPE {{binding_lower}} ##NEEDED. " reference for where-used list
{{/refs}}

    DATA(lv_sadl_xml) =
               |<?xml version="1.0" encoding="utf-16"?>| &
               |<sadl:definition xmlns:sadl="http://sap.com/sap.nw.f.sadl" syntaxVersion="V2" >| &
{{#sadl_sources}}               | <sadl:dataSource type="{{type}}" name="{{name}}" binding="{{binding}}" />| &
{{/sadl_sources}}               |<sadl:resultSet>| &
{{#sadl_structures}}               |<sadl:structure name="{{name}}" dataSource="{{name}}" maxEditMode="{{edit_mode}}" >| &
               | <sadl:query name="EntitySetDefault">| &
               | </sadl:query>| &
{{#properties}}               | <sadl:attribute name="{{abap_field}}" binding="{{abap_field}}" isOutput="TRUE" isKey="{{key}}" />| &
{{/properties}}               |</sadl:structure>| &
{{/sadl_structures}}               |</sadl:resultSet>| &
               |</sadl:definition>| .
    ro_dpc = cl_sadl_gw_dpc_factory=>create_for_sadl( iv_sadl_xml   = lv_sadl_xml
               iv_timestamp         = {{generated_at}}
               iv_uuid              = '{{project}}'
               io_query_control     = me
               io_extension_control = me
               io_context           = me->mo_context ).
  endmethod.
