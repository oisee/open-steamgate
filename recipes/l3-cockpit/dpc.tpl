* Generated run cockpit of {{set}}; do not edit.
CLASS {{class}} DEFINITION PUBLIC INHERITING FROM {{base}} CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.
  PROTECTED SECTION.
{{#entities}}
    METHODS {{method}}_get_entityset REDEFINITION.
    METHODS {{method}}_get_entity REDEFINITION.
{{/entities}}
  PRIVATE SECTION.
    METHODS parameter
      IMPORTING it_params TYPE /iwbep/t_mgw_name_value_pair iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.
CLASS {{class}} IMPLEMENTATION.
  METHOD parameter.
    DATA ls_param TYPE /iwbep/s_mgw_name_value_pair.
    READ TABLE it_params INTO ls_param WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_param-value.
    ENDIF.
  ENDMETHOD.
{{#entities}}
  METHOD {{method}}_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
{{#run}}
    DATA lt_stages TYPE STANDARD TABLE OF zosd_l3_stage WITH DEFAULT KEY.
    DATA ls_stage TYPE zosd_l3_stage.
    DATA ls_run TYPE zosd_l3_run.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA lv_status TYPE zosd_l3_stage-status.
    FIELD-SYMBOLS <ls_run> TYPE zosd_l3_run.
{{#columns}}
    DATA lt_{{field}} TYPE RANGE OF zosd_l3_run-{{field}}.
{{/columns}}
{{/run}}
{{#setting}}
    {{runner}}=>settings_seed( ).
{{/setting}}
    lv_where = io_tech_request_context->get_osql_where_clause( ).
    IF lv_where IS INITIAL.
      lv_where = '1 = 1'.
    ENDIF.
{{#has_run}}
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |( { lv_where } ) AND RUN_ID = '{ lv_run }'|.
    ENDIF.
{{/has_run}}
    SELECT * FROM {{table}} INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE set_name = {{set | literal}} AND (lv_where).
{{#run}}
    SELECT * FROM zosd_l3_stage INTO TABLE lt_stages WHERE set_name = {{set | literal}} AND stage_no = 1.
    LOOP AT lt_stages INTO ls_stage.
      READ TABLE et_entityset TRANSPORTING NO FIELDS WITH KEY run_id = ls_stage-run_id.
      IF sy-subrc = 0.
        CONTINUE.
      ENDIF.
      CLEAR ls_run.
      ls_run-set_name = ls_stage-set_name.
      ls_run-check_date = ls_stage-check_date.
      ls_run-run_id = ls_stage-run_id.
      ls_run-started = ls_stage-opened.
      SELECT SINGLE status FROM zosd_l3_stage INTO ls_run-status
        WHERE set_name = {{set | literal}} AND run_id = ls_stage-run_id AND stage_no = {{stage_count}}.
      APPEND ls_run TO et_entityset.
    ENDLOOP.
    LOOP AT et_entityset ASSIGNING <ls_run>.
      SELECT SINGLE status FROM zosd_l3_stage INTO lv_status
        WHERE set_name = {{set | literal}} AND run_id = <ls_run>-run_id AND stage_no = {{stage_count}}.
      IF sy-subrc = 0.
        <ls_run>-status = lv_status.
      ENDIF.
{{#governed}}
      SELECT SINGLE state FROM zosd_l3_budget INTO lv_status
        WHERE set_name = {{set | literal}} AND run_id = <ls_run>-run_id AND state = 'GLASS'.
      IF sy-subrc = 0.
        <ls_run>-status = lv_status.
      ENDIF.
{{/governed}}
    ENDLOOP.
    LOOP AT it_filter_select_options INTO ls_filter.
      CASE ls_filter-property.
{{#columns}}
        WHEN '{{property}}'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_{{field}} ).
          DELETE et_entityset WHERE {{field}} NOT IN lt_{{field}}.
{{/columns}}
      ENDCASE.
    ENDLOOP.
    SORT et_entityset BY started DESCENDING run_id DESCENDING.
{{/run}}
{{#order}}
    SORT et_entityset BY {{order}}.
{{/order}}
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD {{method}}_get_entity.
{{#keys}}
    DATA lv_{{field}} TYPE {{table}}-{{field}}.
{{/keys}}
{{#run}}
    DATA ls_stage TYPE zosd_l3_stage.
{{/run}}
{{#keys}}
    lv_{{field}} = parameter( it_params = it_key_tab iv_name = '{{property}}' ).
{{/keys}}
    SELECT SINGLE * FROM {{table}} INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = {{set | literal}}
{{#keys}}
        AND {{field}} = lv_{{field}}{{#last}}.{{/last}}
{{/keys}}
{{#run}}
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM zosd_l3_stage INTO ls_stage
        WHERE set_name = {{set | literal}} AND run_id = lv_run_id AND stage_no = 1.
      IF sy-subrc = 0.
        er_entity-run_id = ls_stage-run_id.
        er_entity-check_date = ls_stage-check_date.
        er_entity-set_name = ls_stage-set_name.
        er_entity-started = ls_stage-opened.
        SELECT SINGLE status FROM zosd_l3_stage INTO er_entity-status
          WHERE set_name = {{set | literal}} AND run_id = lv_run_id AND stage_no = {{stage_count}}.
      ENDIF.
    ENDIF.
    SELECT SINGLE status FROM zosd_l3_stage INTO er_entity-status
      WHERE set_name = {{set | literal}} AND run_id = lv_run_id AND stage_no = {{stage_count}}.
{{#governed}}
    SELECT SINGLE state FROM zosd_l3_budget INTO er_entity-status
      WHERE set_name = {{set | literal}} AND run_id = lv_run_id AND state = 'GLASS'.
{{/governed}}
{{/run}}
  ENDMETHOD.
{{/entities}}
  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    DATA lx_error TYPE REF TO cx_root.
    DATA lv_text TYPE string.
    DATA ls_answer TYPE {{mpc}}=>ts_answer.
    DATA ls_run TYPE {{runner}}=>ty_result.
    DATA lv_date TYPE d.
    DATA lv_mode TYPE c LENGTH 1.
    DATA lv_work TYPE string.
    DATA lv_run TYPE string.
    DATA lv_rule TYPE string.
    DATA lv_reason TYPE string.
    DATA lv_param TYPE string.
    DATA lv_value TYPE string.
    DATA lv_note TYPE string.
    DATA lv_pile TYPE i.
    DATA lv_cap TYPE i.
    DATA lv_glass TYPE i.
    DATA lv_ok TYPE abap_bool.
{{#resilience}}
    DATA lt_report TYPE {{runner}}=>tt_doctor.
    DATA ls_report TYPE {{runner}}=>ty_doctor.
{{/resilience}}
    lv_run = parameter( it_params = it_parameter iv_name = 'RunId' ).
    lv_date = parameter( it_params = it_parameter iv_name = 'CheckDate' ).
    lv_mode = parameter( it_params = it_parameter iv_name = 'Mode' ).
    lv_work = parameter( it_params = it_parameter iv_name = 'Work' ).
    lv_rule = parameter( it_params = it_parameter iv_name = 'RuleName' ).
    lv_reason = parameter( it_params = it_parameter iv_name = 'Reason' ).
    lv_param = parameter( it_params = it_parameter iv_name = 'Param' ).
    lv_value = parameter( it_params = it_parameter iv_name = 'Value' ).
    lv_note = parameter( it_params = it_parameter iv_name = 'Note' ).
    lv_pile = parameter( it_params = it_parameter iv_name = 'PileNo' ).
    lv_cap = parameter( it_params = it_parameter iv_name = 'PerPile' ).
    lv_glass = parameter( it_params = it_parameter iv_name = 'NewGlass' ).
    ls_answer-run_id = lv_run.
    TRY.
    CASE iv_action_name.
{{#actions}}
      WHEN '{{name}}'.
        {{call}}
{{/actions}}
      WHEN OTHERS.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
          EXPORTING method = iv_action_name.
    ENDCASE.
    CATCH cx_root INTO lx_error.
      lv_text = lx_error->get_text( ).
      ls_answer-answer = |REFUSED: { lv_text }|.
    ENDTRY.
    copy_data_to_ref( EXPORTING is_data = ls_answer CHANGING cr_data = er_data ).
  ENDMETHOD.
ENDCLASS.
