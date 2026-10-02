{{! The leading blank and log call exist only for a nonempty log attribute; its name is lower case. }}
{{#log}}{{#name}}
 IF {{name}} IS NOT INITIAL.
   me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(
     EXPORTING
       iv_entity_type = iv_entity_name
       it_return      = {{name}}
       it_key_tab     = it_key_tab ).
 ENDIF.
{{/name}}
{{/log}}
