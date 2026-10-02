{{! Local widths start at 14, remote at 21. Local TRY catches cx_root; remote adds communication_failure. Parameter order stays mapping order. }}
 IF lv_destination IS INITIAL OR lv_destination EQ 'NONE'.

   TRY.
       CALL FUNCTION lv_rfc_name
{{#groups}}         {{#is_importing}}EXPORTING{{/is_importing}}{{#is_exporting}}IMPORTING{{/is_exporting}}{{#is_tables}}TABLES{{/is_tables}}{{#is_changing}}CHANGING{{/is_changing}}
{{#parameters}}           {{name}}{{local_gap}} = {{name}}
{{/parameters}}{{/groups}}{{#exceptions}}         EXCEPTIONS
           system_failure{{exceptions.local_system_failure_gap}} = {{exceptions.system_failure_code}}  MESSAGE lv_exc_msg
           OTHERS{{exceptions.local_others_gap}} = {{exceptions.others_code}}.
{{/exceptions}}

       lv_subrc = sy-subrc.
*in case of co-deployment the exception is raised and needs to be caught
     CATCH cx_root INTO lx_root.
       lv_subrc = {{exceptions.caught_code}}.
       lv_exc_msg = lx_root->if_message~get_text( ).
   ENDTRY.

 ELSE.

   CALL FUNCTION lv_rfc_name DESTINATION lv_destination
{{#groups}}     {{#is_importing}}EXPORTING{{/is_importing}}{{#is_exporting}}IMPORTING{{/is_exporting}}{{#is_tables}}TABLES{{/is_tables}}{{#is_changing}}CHANGING{{/is_changing}}
{{#parameters}}       {{name}}{{remote_gap}} = {{name}}
{{/parameters}}{{/groups}}{{#exceptions}}     EXCEPTIONS
       system_failure{{exceptions.remote_system_failure_gap}} = {{exceptions.system_failure_code}}  MESSAGE lv_exc_msg
       communication_failure{{exceptions.remote_communication_failure_gap}} = {{exceptions.communication_failure_code}}  MESSAGE lv_exc_msg
       OTHERS{{exceptions.remote_others_gap}} = {{exceptions.others_code}}.
{{/exceptions}}

   lv_subrc = sy-subrc.

 ENDIF.
