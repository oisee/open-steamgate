{{! Query converts inside the nested select-option loop; ranges are ordered H L O S. Skip starts at skip plus one. }}
  method {{method}}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
{{> rfc-declarations}}

{{> rfc-request_banner}}* Get filter or select option information
 lo_filter = io_tech_request_context->get_filter( ).
 lt_filter_select_options = lo_filter->get_filter_select_options( ).
 lv_filter_str = lo_filter->get_filter_string( ).

* Check if the supplied filter is supported by standard gateway runtime process
 IF  lv_filter_str            IS NOT INITIAL
 AND lt_filter_select_options IS INITIAL.
   " If the string of the Filter System Query Option is not automatically converted into
   " filter option table (lt_filter_select_options), then the filtering combination is not supported
   " Log message in the application log
   me->/iwbep/if_sb_dpc_comm_services~log_message(
     EXPORTING
       iv_msg_type   = 'E'
       iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
       iv_msg_number = 025 ).
   " Raise Exception
   RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
     EXPORTING
       textid = /iwbep/cx_mgw_tech_exception=>internal_error.
 ENDIF.

* Get key table information
 io_tech_request_context->get_converted_source_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).

 ls_paging-top = io_tech_request_context->get_top( ).
 ls_paging-skip = io_tech_request_context->get_skip( ).
{{> rfc-constant_lines}}{{#has_navigation}}
* Maps key fields to function module parameters
 IF it_key_tab IS NOT INITIAL.
   lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).
{{#navigation}}   IF  lv_source_entity_set_name = '{{set}}'.
     " Convert keys to appropriate entity set structure
     io_tech_request_context->get_converted_source_keys(
       IMPORTING
         es_key_values  = {{variable}}_get_entityset ).
     {{parameter}}{{#component}}-{{component}}{{/component}} = {{variable}}_get_entityset-{{source_field}}.
   ENDIF.
{{/navigation}} ENDIF.
{{/has_navigation}}{{#has_filters}}
 IF it_filter_select_options IS NOT INITIAL.
* Maps filter table lines to function module parameters
   LOOP AT lt_filter_select_options INTO ls_filter.

     LOOP AT ls_filter-select_options INTO ls_filter_range.
       CASE ls_filter-property.
{{#filters}}         WHEN '{{field | upper}}'.              " Equivalent to '{{property}}' property in the service
           lo_filter->convert_select_option(
             EXPORTING
               is_select_option = ls_filter
             IMPORTING
               et_select_option = lr_{{field}} ).
{{#has_ranges}}           LOOP AT lr_{{field}} INTO ls_{{field}}.
{{#ranges}}             ls_{{parameter}}-{{component}} = ls_{{field}}-{{semantic}}.
{{/ranges}}             APPEND ls_{{parameter}} TO {{parameter}}.
           ENDLOOP.
{{/has_ranges}}{{^has_ranges}}           READ TABLE lr_{{field}} INTO ls_{{field}} INDEX 1.
           IF sy-subrc = 0.
             {{parameter}}{{#component}}-{{component}}{{/component}} = ls_{{field}}-low.
           ENDIF.
{{/has_ranges}}{{/filters}}         WHEN OTHERS.
           " Log message in the application log
           me->/iwbep/if_sb_dpc_comm_services~log_message(
             EXPORTING
               iv_msg_type   = 'E'
               iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
               iv_msg_number = 020
               iv_msg_v1     = ls_filter-property ).
           " Raise Exception
           RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
             EXPORTING
               textid = /iwbep/cx_mgw_tech_exception=>internal_error.
       ENDCASE.
     ENDLOOP.

   ENDLOOP.
 ENDIF.
{{/has_filters}}{{> rfc-append_constant_lines}}{{> rfc-get_destination}}{{#module}} lv_rfc_name = '{{name}}'.
{{/module}}

{{> rfc-call_function}}

{{> rfc-error_handling}}{{> rfc-save_log}}
*-------------------------------------------------------------------------*
*             - Post Backend Call -
*-------------------------------------------------------------------------*
{{#out_table.name}} IF ls_paging-skip IS NOT INITIAL.
*  If the Skip value was requested at runtime
*  the response table will provide backend entries from skip + 1, meaning start from skip +1
*  for example: skip=5 means to start get results from the 6th row
   lv_skip = ls_paging-skip + 1.
 ENDIF.
*  The Top value was requested at runtime but was not handled as part of the function interface
 IF  ls_paging-top <> 0
 AND lv_skip IS NOT INITIAL.
*  if lv_skip > 0 retrieve the entries from lv_skip + Top - 1
*  for example: skip=5 and top=2 means to start get results from the 6th row and end in row number 7
   lv_top = ls_paging-top + lv_skip - 1.
 ELSEIF ls_paging-top <> 0
 AND    lv_skip IS INITIAL.
   lv_top = ls_paging-top.
 ELSE.
   lv_top = LINES( {{out_table.name}} ).
 ENDIF.

*  - Map properties from the backend to the Gateway output response table -

 LOOP AT {{out_table.name}} INTO ls_{{out_table.name}}
*  Provide the response entries according to the Top and Skip parameters that were provided at runtime
      FROM lv_skip TO lv_top.
*  Only fields that were mapped will be delivered to the response table
{{#outputs}}   ls_gw_{{parameter}}-{{field}} = ls_{{parameter}}-{{component}}.
{{/outputs}}   APPEND ls_gw_{{out_table.name}} TO et_entityset.
   CLEAR ls_gw_{{out_table.name}}.
 ENDLOOP.
{{/out_table.name}}  endmethod.
