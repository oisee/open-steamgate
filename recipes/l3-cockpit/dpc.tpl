* Generated run cockpit of {{set}}; do not edit.
CLASS {{class}} DEFINITION PUBLIC INHERITING FROM {{base}} CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.
  PROTECTED SECTION.
{{#entities}}
    METHODS {{method}}_get_entityset REDEFINITION.
    METHODS {{method}}_get_entity REDEFINITION.
{{/entities}}
    METHODS tallyset_get_entityset REDEFINITION.
    METHODS statusvhset_get_entityset REDEFINITION.
  PRIVATE SECTION.
    METHODS criticality
      IMPORTING iv_status TYPE csequence
      RETURNING VALUE(rv_criticality) TYPE i.
    METHODS enrich_run
      CHANGING cs_run TYPE {{mpc}}=>ts_run.
    METHODS parameter
      IMPORTING it_params TYPE /iwbep/t_mgw_name_value_pair iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.
CLASS {{class}} IMPLEMENTATION.
  METHOD criticality.
    " UI.CriticalityType: 3 positive, 2 critical, 1 negative, 0 neutral
    CASE iv_status.
{{#criticality}}
      WHEN {{statuses}}.
        rv_criticality = {{value}}.
{{/criticality}}
      WHEN OTHERS.
        rv_criticality = 0.
    ENDCASE.
  ENDMETHOD.
  METHOD enrich_run.
    " what the run page shows beyond the run's row: the title, the piles
    " by status, the budget against its levels and which actions apply
    DATA lt_piles TYPE STANDARD TABLE OF zosd_l3_pile WITH DEFAULT KEY.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_lock TYPE zosd_l3_run.
    DATA ls_stage TYPE zosd_l3_stage.
{{#governed}}
    DATA ls_budget TYPE zosd_l3_budget.
{{/governed}}
    DATA lv_date TYPE string.
    DATA lv_count TYPE i.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
      WHERE set_name = {{set | literal}} AND run_id = cs_run-run_id.
    cs_run-run_mode = 'S'.
    cs_run-piles = lines( lt_piles ).
    LOOP AT lt_piles INTO ls_pile.
      CASE ls_pile-status.
        WHEN 'DONE'.
          cs_run-piles_done = cs_run-piles_done + 1.
        WHEN 'RUNNING'.
          cs_run-piles_running = cs_run-piles_running + 1.
        WHEN 'FAILED' OR 'FUSED'.
          cs_run-piles_failed = cs_run-piles_failed + 1.
        WHEN 'HELD' OR 'GLASS'.
          cs_run-piles_held = cs_run-piles_held + 1.
      ENDCASE.
      " a pile a job carried: the run was started in jobs
      IF ls_pile-job_name IS NOT INITIAL.
        cs_run-run_mode = 'P'.
      ENDIF.
    ENDLOOP.
    cs_run-piles_final = cs_run-piles_done + cs_run-piles_failed.
    IF cs_run-piles > 0.
      cs_run-pct_final = cs_run-piles_final * 100 / cs_run-piles.
    ENDIF.
    SELECT SINGLE * FROM zosd_l3_stage INTO ls_stage
      WHERE set_name = {{set | literal}} AND run_id = cs_run-run_id AND stage_no = 1.
    IF ls_stage-run_bind CS 'work=sim'.
      cs_run-twin = abap_true.
    ENDIF.
    " open: the run still holds the lock of its date
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = {{set | literal}} AND check_date = cs_run-check_date.
    IF sy-subrc = 0 AND ls_lock-run_id = cs_run-run_id AND ls_lock-status = 'HELD'.
      cs_run-is_open = abap_true.
    ENDIF.
{{#governed}}
    SELECT SINGLE * FROM zosd_l3_budget INTO ls_budget
      WHERE set_name = {{set | literal}} AND run_id = cs_run-run_id.
    cs_run-reserved = ls_budget-reserved.
    cs_run-glass = ls_budget-glass.
    cs_run-warn_level = ls_budget-glass * ls_budget-warn_at / 10000.
    cs_run-narrow_level = ls_budget-glass * ls_budget-narrow_at / 10000.
{{/governed}}
    cs_run-status_crit = criticality( cs_run-status ).
    IF cs_run-status = 'GLASS'.
      cs_run-can_continue = abap_true.
    ELSEIF cs_run-is_open = abap_true.
      cs_run-can_resume = abap_true.
    ENDIF.
    lv_date = |{ cs_run-check_date+0(4) }-{ cs_run-check_date+4(2) }-{ cs_run-check_date+6(2) }|.
    cs_run-title = |{ cs_run-set_name } / { lv_date }|.
    IF cs_run-run_mode = 'P'.
      cs_run-run_label = |{ lv_date } / In jobs|.
    ELSE.
      cs_run-run_label = |{ lv_date } / Now|.
    ENDIF.
    IF cs_run-twin = abap_true.
      cs_run-run_label = |{ cs_run-run_label } / SIM|.
    ENDIF.
    " a section without rows is hidden rather than shown empty
{{#hides}}
    SELECT COUNT( * ) FROM {{table}} INTO lv_count
      WHERE set_name = {{set | literal}} AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-{{field}} = abap_true.
    ENDIF.
{{/hides}}
  ENDMETHOD.
  METHOD tallyset_get_entityset.
    " the piles of one run by status, in a fixed order: the pile bar
    DATA lt_piles TYPE STANDARD TABLE OF zosd_l3_pile WITH DEFAULT KEY.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA lt_order TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_status TYPE string.
    DATA lt_counts TYPE {{mpc}}=>tt_tally.
    DATA ls_tally TYPE {{mpc}}=>ts_tally.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA ls_range LIKE LINE OF ls_filter-select_options.
    DATA lv_run TYPE string.
    FIELD-SYMBOLS <ls_tally> TYPE {{mpc}}=>ts_tally.
    lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    LOOP AT it_filter_select_options INTO ls_filter WHERE property = 'RunId'.
      LOOP AT ls_filter-select_options INTO ls_range.
        lv_run = ls_range-low.
      ENDLOOP.
    ENDLOOP.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
      WHERE set_name = {{set | literal}} AND run_id = lv_run.
    LOOP AT lt_piles INTO ls_pile.
      READ TABLE lt_counts ASSIGNING <ls_tally> WITH KEY status = ls_pile-status.
      IF sy-subrc <> 0.
        CLEAR ls_tally.
        ls_tally-run_id = lv_run.
        ls_tally-status = ls_pile-status.
        ls_tally-status_crit = criticality( ls_pile-status ).
        APPEND ls_tally TO lt_counts ASSIGNING <ls_tally>.
      ENDIF.
      <ls_tally>-piles = <ls_tally>-piles + 1.
    ENDLOOP.
    SPLIT {{tally_text}} AT space INTO TABLE lt_order.
    LOOP AT lt_order INTO lv_status.
      READ TABLE lt_counts INTO ls_tally WITH KEY status = lv_status.
      IF sy-subrc = 0.
        APPEND ls_tally TO et_entityset.
        DELETE lt_counts WHERE status = lv_status.
      ENDIF.
    ENDLOOP.
    APPEND LINES OF lt_counts TO et_entityset.
    es_response_context-inlinecount = lines( et_entityset ).
  ENDMETHOD.
  METHOD statusvhset_get_entityset.
    " the statuses a run shows, for the fixed value list of the run filter
    DATA ls_status TYPE {{mpc}}=>ts_statusvh.
{{#run_statuses}}
    ls_status-status = {{status}}.
    ls_status-text = {{text}}.
    APPEND ls_status TO et_entityset.
{{/run_statuses}}
    es_response_context-inlinecount = lines( et_entityset ).
  ENDMETHOD.
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
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
{{#run}}
    DATA lt_stages TYPE STANDARD TABLE OF zosd_l3_stage WITH DEFAULT KEY.
    DATA ls_stage TYPE zosd_l3_stage.
    DATA ls_run LIKE LINE OF et_entityset.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA lv_status TYPE zosd_l3_stage-status.
    FIELD-SYMBOLS <ls_run> LIKE LINE OF et_entityset.
{{#columns}}
    DATA lt_{{field}} TYPE RANGE OF zosd_l3_run-{{field}}.
{{/columns}}
{{/run}}
{{#has_crit}}
{{^run}}
    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_entityset.
{{/run}}
{{/has_crit}}
{{#setting}}
    {{runner}}=>settings_seed( ).
{{/setting}}
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = '{{set}}'|.
{{^run}}
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
{{/run}}
{{#run}}
    " a run's filter applies to what the run shows (its status is derived
    " from the stages), so it narrows the rows below, after they are built
{{/run}}
{{#has_run}}
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
{{/has_run}}
    SELECT * FROM {{table}} INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
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
{{#run}}
    LOOP AT et_entityset ASSIGNING <ls_run>.
      enrich_run( CHANGING cs_run = <ls_run> ).
    ENDLOOP.
{{/run}}
{{#has_crit}}
{{^run}}
    LOOP AT et_entityset ASSIGNING <ls_row>.
      <ls_row>-{{crit}} = criticality( <ls_row>-{{crit_of}} ).
{{#release}}
      IF <ls_row>-status = 'HELD'.
        <ls_row>-can_release = abap_true.
      ENDIF.
{{/release}}
    ENDLOOP.
{{/run}}
{{/has_crit}}
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
    IF er_entity-run_id IS NOT INITIAL.
      enrich_run( CHANGING cs_run = er_entity ).
    ENDIF.
{{/run}}
{{#has_crit}}
{{^run}}
    er_entity-{{crit}} = criticality( er_entity-{{crit_of}} ).
{{#release}}
    IF er_entity-status = 'HELD'.
      er_entity-can_release = abap_true.
    ENDIF.
{{/release}}
{{/run}}
{{/has_crit}}
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
{{#scheduled}}
    DATA ls_unschedule TYPE {{runner}}=>ty_unschedule.
{{/scheduled}}
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
