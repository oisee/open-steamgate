* Generated run cockpit of fleet2; do not edit.
CLASS zcl_zl3c_fleet2_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zl3c_fleet2_dpc CREATE PUBLIC.
  PUBLIC SECTION.
    " a name as a whole identifier in a filter text (static: the test asks it directly)
    CLASS-METHODS names
      IMPORTING iv_text TYPE string iv_name TYPE string
      RETURNING VALUE(rv_found) TYPE abap_bool.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.
  PROTECTED SECTION.
    METHODS runset_get_entityset REDEFINITION.
    METHODS runset_get_entity REDEFINITION.
    METHODS stageset_get_entityset REDEFINITION.
    METHODS stageset_get_entity REDEFINITION.
    METHODS pileset_get_entityset REDEFINITION.
    METHODS pileset_get_entity REDEFINITION.
    METHODS budgetset_get_entityset REDEFINITION.
    METHODS budgetset_get_entity REDEFINITION.
    METHODS eventset_get_entityset REDEFINITION.
    METHODS eventset_get_entity REDEFINITION.
    METHODS doctorset_get_entityset REDEFINITION.
    METHODS doctorset_get_entity REDEFINITION.
    METHODS runstatset_get_entityset REDEFINITION.
    METHODS runstatset_get_entity REDEFINITION.
    METHODS settingset_get_entityset REDEFINITION.
    METHODS settingset_get_entity REDEFINITION.
    METHODS changeset_get_entityset REDEFINITION.
    METHODS changeset_get_entity REDEFINITION.
    METHODS confsnapset_get_entityset REDEFINITION.
    METHODS confsnapset_get_entity REDEFINITION.
    METHODS snapshotset_get_entityset REDEFINITION.
    METHODS snapshotset_get_entity REDEFINITION.
    METHODS tallyset_get_entityset REDEFINITION.
    METHODS statusvhset_get_entityset REDEFINITION.
  PRIVATE SECTION.
    METHODS criticality
      IMPORTING iv_status TYPE csequence
      RETURNING VALUE(rv_criticality) TYPE i.
    METHODS enrich_run
      CHANGING cs_run TYPE zcl_zl3c_fleet2_mpc=>ts_run.
    METHODS refuse_computed
      IMPORTING iv_where TYPE string iv_filter TYPE string it_options TYPE /iwbep/t_mgw_select_option
                it_order TYPE /iwbep/t_mgw_sorting_order
                iv_fields TYPE string iv_properties TYPE string
      RAISING /iwbep/cx_mgw_busi_exception.
    METHODS parameter
      IMPORTING it_params TYPE /iwbep/t_mgw_name_value_pair iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.
CLASS zcl_zl3c_fleet2_dpc_ext IMPLEMENTATION.
  METHOD criticality.
    " UI.CriticalityType: 3 positive, 2 critical, 1 negative, 0 neutral
    CASE iv_status.
      WHEN 'FAILED' OR 'GLASS' OR 'FUSED' OR 'KILLED' OR 'WRITE-FAILED'.
        rv_criticality = 1.
      WHEN 'HELD' OR 'NARROW' OR 'PARTIAL' OR 'WARN'.
        rv_criticality = 2.
      WHEN 'DONE'.
        rv_criticality = 3.
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
    DATA ls_budget TYPE zosd_l3_budget.
    DATA lv_date TYPE string.
    DATA lv_count TYPE i.
    DATA lv_aborted TYPE btch0000-char1.
    DATA lv_finished TYPE btch0000-char1.
    DATA lv_running TYPE btch0000-char1.
    DATA lv_ready TYPE btch0000-char1.
    DATA lv_scheduled TYPE btch0000-char1.
    DATA lv_preliminary TYPE btch0000-char1.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    cs_run-run_mode = 'S'.
    cs_run-piles = lines( lt_piles ).
    LOOP AT lt_piles INTO ls_pile.
      " a pile RUNNING in a job that is over or gone: only the doctor fails it; the
      " page says so meanwhile (read only, and only for this run's RUNNING piles)
      IF ls_pile-status = 'RUNNING' AND ls_pile-job_count IS NOT INITIAL.
        CLEAR: lv_aborted, lv_finished, lv_running, lv_ready, lv_scheduled, lv_preliminary.
        CALL FUNCTION 'SHOW_JOBSTATE'
          EXPORTING
            jobname = ls_pile-job_name
            jobcount = ls_pile-job_count
          IMPORTING
            aborted = lv_aborted
            finished = lv_finished
            preliminary = lv_preliminary
            ready = lv_ready
            running = lv_running
            scheduled = lv_scheduled
          EXCEPTIONS
            OTHERS = 1.
        IF sy-subrc <> 0 OR lv_finished = 'X' OR lv_aborted = 'X'.
          cs_run-piles_orphaned = cs_run-piles_orphaned + 1.
        ENDIF.
      ENDIF.
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
      " done of planned: a failed pile is final and not done
      cs_run-pct_final = cs_run-piles_done * 100 / cs_run-piles.
    ENDIF.
    SELECT SINGLE * FROM zosd_l3_stage INTO ls_stage
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id AND stage_no = 1.
    IF ls_stage-run_bind CS 'work=sim'.
      cs_run-twin = abap_true.
    ENDIF.
    " open: the run still holds the lock of its date
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = 'fleet2' AND check_date = cs_run-check_date.
    IF sy-subrc = 0 AND ls_lock-run_id = cs_run-run_id AND ls_lock-status = 'HELD'.
      cs_run-is_open = abap_true.
    ENDIF.
    SELECT SINGLE * FROM zosd_l3_budget INTO ls_budget
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    cs_run-reserved = ls_budget-reserved.
    cs_run-glass = ls_budget-glass.
    cs_run-warn_level = ls_budget-glass * ls_budget-warn_at / 10000.
    cs_run-narrow_level = ls_budget-glass * ls_budget-narrow_at / 10000.
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
    SELECT COUNT( * ) FROM zosd_l3_stage INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_stage = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_pile INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_pile = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_budget INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_budget = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_event INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_event = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_doctor INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_doctor = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_runstat INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_runstat = abap_true.
    ENDIF.
    SELECT COUNT( * ) FROM zosd_l3_run_conf INTO lv_count
      WHERE set_name = 'fleet2' AND run_id = cs_run-run_id.
    IF lv_count = 0.
      cs_run-hide_snapshot = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD refuse_computed.
    " a computed field is filled after the read: a filter on it would be ignored
    " and the count and the paging would be wrong, so it is refused in words
    DATA lv_where TYPE string.
    DATA lv_name TYPE string.
    DATA lv_field TYPE string.
    DATA lv_property TYPE string.
    DATA lt_names TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lt_fields TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA ls_option TYPE /iwbep/s_mgw_select_option.
    DATA ls_order TYPE /iwbep/s_mgw_sorting_order.
    SPLIT iv_properties AT space INTO TABLE lt_names.
    DELETE lt_names WHERE table_line IS INITIAL.
    LOOP AT it_options INTO ls_option.
      READ TABLE lt_names TRANSPORTING NO FIELDS WITH KEY table_line = ls_option-property.
      IF sy-subrc = 0.
        lv_name = ls_option-property.
      ENDIF.
    ENDLOOP.
    IF lv_name IS INITIAL.
      " a filter that is no select option (an OR across properties): the names it
      " uses, as fields or as properties, never the values in quotes
      CONCATENATE iv_where iv_filter INTO lv_where SEPARATED BY space.
      REPLACE ALL OCCURRENCES OF REGEX `'[^']*'` IN lv_where WITH ``.
      SPLIT iv_fields AT space INTO TABLE lt_fields.
      DELETE lt_fields WHERE table_line IS INITIAL.
      " the fields come in the order of the properties: the answer names the property
      LOOP AT lt_fields INTO lv_field.
        READ TABLE lt_names INTO lv_property INDEX sy-tabix.
        IF names( iv_text = lv_where iv_name = lv_field ) = abap_true OR names( iv_text = lv_where iv_name = lv_property ) = abap_true.
          lv_name = lv_property.
        ENDIF.
      ENDLOOP.
    ENDIF.
    IF lv_name IS NOT INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message_unlimited = |{ lv_name } is computed after the read and cannot be filtered on|.
    ENDIF.
    " a sort on it would be ignored as well: the rows keep their own order before paging
    LOOP AT it_order INTO ls_order.
      READ TABLE lt_names TRANSPORTING NO FIELDS WITH KEY table_line = ls_order-property.
      IF sy-subrc = 0.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
          EXPORTING message_unlimited = |{ ls_order-property } is computed after the read and cannot be sorted on|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD names.
    " a whole identifier: PILES is not part of PILES_DONE, Open not of OpenAlerts
    DATA lv_regex TYPE string.
    CONCATENATE '(^|[^A-Za-z0-9_])' iv_name '($|[^A-Za-z0-9_])' INTO lv_regex.
    FIND FIRST OCCURRENCE OF REGEX lv_regex IN iv_text.
    IF sy-subrc = 0.
      rv_found = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD tallyset_get_entityset.
    " the piles of one run by status, in a fixed order: the pile bar
    DATA lt_piles TYPE STANDARD TABLE OF zosd_l3_pile WITH DEFAULT KEY.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA lt_order TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_status TYPE string.
    DATA lt_counts TYPE zcl_zl3c_fleet2_mpc=>tt_tally.
    DATA ls_tally TYPE zcl_zl3c_fleet2_mpc=>ts_tally.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA ls_range LIKE LINE OF ls_filter-select_options.
    DATA lv_run TYPE string.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    FIELD-SYMBOLS <ls_tally> TYPE zcl_zl3c_fleet2_mpc=>ts_tally.
    CONCATENATE lv_computed_fields 'STATUS PILES STATUS_CRIT LABEL' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'Status Piles StatusCriticality Label' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    LOOP AT it_filter_select_options INTO ls_filter WHERE property = 'RunId'.
      LOOP AT ls_filter-select_options INTO ls_range.
        lv_run = ls_range-low.
      ENDLOOP.
    ENDLOOP.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
      WHERE set_name = 'fleet2' AND run_id = lv_run.
    LOOP AT lt_piles INTO ls_pile.
      READ TABLE lt_counts ASSIGNING <ls_tally> WITH KEY status = ls_pile-status.
      IF sy-subrc <> 0.
        CLEAR ls_tally.
        ls_tally-run_id = lv_run.
        ls_tally-status = ls_pile-status.
        ls_tally-status_crit = criticality( ls_pile-status ).
        " in the bar only FAILED is red: piles at the glass wait for a person
        IF ls_pile-status = 'GLASS'.
          ls_tally-status_crit = 2.
        ENDIF.
        APPEND ls_tally TO lt_counts ASSIGNING <ls_tally>.
      ENDIF.
      <ls_tally>-piles = <ls_tally>-piles + 1.
      <ls_tally>-label = |{ <ls_tally>-status } { <ls_tally>-piles }|.
    ENDLOOP.
    SPLIT 'DONE RUNNING PLANNED HELD GLASS FAILED FUSED' AT space INTO TABLE lt_order.
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
    DATA ls_status TYPE zcl_zl3c_fleet2_mpc=>ts_statusvh.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    CONCATENATE lv_computed_fields 'STATUS TEXT' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'Status Text' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    ls_status-status = 'OPEN'.
    ls_status-text = 'Open: the first stage runs'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'WAITING'.
    ls_status-text = 'Waiting: a stage waits for its gate'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'SUBMITTED'.
    ls_status-text = 'Submitted: background jobs carry the piles'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'GLASS'.
    ls_status-text = 'Stopped at the glass: a person continues it'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'DONE'.
    ls_status-text = 'Done'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'PARTIAL'.
    ls_status-text = 'Partial: piles did not complete'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'FAILED'.
    ls_status-text = 'Failed'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'NOT-RUN'.
    ls_status-text = 'Not run'.
    APPEND ls_status TO et_entityset.
    ls_status-status = 'KILLED'.
    ls_status-text = 'Killed'.
    APPEND ls_status TO et_entityset.
    es_response_context-inlinecount = lines( et_entityset ).
  ENDMETHOD.
  METHOD parameter.
    DATA ls_param TYPE /iwbep/s_mgw_name_value_pair.
    READ TABLE it_params INTO ls_param WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_param-value.
    ENDIF.
  ENDMETHOD.
  METHOD runset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    DATA lt_stages TYPE STANDARD TABLE OF zosd_l3_stage WITH DEFAULT KEY.
    DATA ls_stage TYPE zosd_l3_stage.
    DATA ls_run LIKE LINE OF et_entityset.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA lv_status TYPE zosd_l3_stage-status.
    FIELD-SYMBOLS <ls_run> LIKE LINE OF et_entityset.
    DATA lt_set_name TYPE RANGE OF zosd_l3_run-set_name.
    DATA lt_check_date TYPE RANGE OF zosd_l3_run-check_date.
    DATA lt_run_id TYPE RANGE OF zosd_l3_run-run_id.
    DATA lt_status TYPE RANGE OF zosd_l3_run-status.
    DATA lt_started TYPE RANGE OF zosd_l3_run-started.
    CONCATENATE lv_computed_fields 'TITLE RUN_LABEL RUN_MODE TWIN IS_OPEN' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_fields 'PILES PILES_FINAL PILES_DONE PILES_RUNNING PILES_FAILED' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_fields 'PILES_HELD PILES_ORPHANED PCT_FINAL STATUS_CRIT CAN_CONTINUE' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_fields 'CAN_RESUME RESERVED GLASS WARN_LEVEL NARROW_LEVEL' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_fields 'HIDE_STAGE HIDE_PILE HIDE_BUDGET HIDE_EVENT HIDE_DOCTOR' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_fields 'HIDE_RUNSTAT HIDE_SNAPSHOT' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'Title RunLabel Mode Twin Open' INTO lv_computed_props SEPARATED BY space.
    CONCATENATE lv_computed_props 'Piles PilesFinal PilesDone PilesRunning PilesFailed' INTO lv_computed_props SEPARATED BY space.
    CONCATENATE lv_computed_props 'PilesHeld PilesOrphaned PctFinal StatusCriticality CanContinue' INTO lv_computed_props SEPARATED BY space.
    CONCATENATE lv_computed_props 'CanResume Reserved Glass WarnLevel NarrowLevel' INTO lv_computed_props SEPARATED BY space.
    CONCATENATE lv_computed_props 'HideStage HidePile HideBudget HideEvent HideDoctor' INTO lv_computed_props SEPARATED BY space.
    CONCATENATE lv_computed_props 'HideRunStat HideSnapshot' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    " a run's filter applies to what the run shows (its status is derived
    " from the stages), so it narrows the rows below, after they are built
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_run INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SELECT * FROM zosd_l3_stage INTO TABLE lt_stages WHERE set_name = 'fleet2' AND stage_no = 1.
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
        WHERE set_name = 'fleet2' AND run_id = ls_stage-run_id AND stage_no = 2.
      APPEND ls_run TO et_entityset.
    ENDLOOP.
    LOOP AT et_entityset ASSIGNING <ls_run>.
      SELECT SINGLE status FROM zosd_l3_stage INTO lv_status
        WHERE set_name = 'fleet2' AND run_id = <ls_run>-run_id AND stage_no = 2.
      IF sy-subrc = 0.
        <ls_run>-status = lv_status.
      ENDIF.
      SELECT SINGLE state FROM zosd_l3_budget INTO lv_status
        WHERE set_name = 'fleet2' AND run_id = <ls_run>-run_id AND state = 'GLASS'.
      IF sy-subrc = 0.
        <ls_run>-status = lv_status.
      ENDIF.
    ENDLOOP.
    LOOP AT it_filter_select_options INTO ls_filter.
      CASE ls_filter-property.
        WHEN 'SetName'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_set_name ).
          DELETE et_entityset WHERE set_name NOT IN lt_set_name.
        WHEN 'CheckDate'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_check_date ).
          DELETE et_entityset WHERE check_date NOT IN lt_check_date.
        WHEN 'RunId'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_run_id ).
          DELETE et_entityset WHERE run_id NOT IN lt_run_id.
        WHEN 'Status'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_status ).
          DELETE et_entityset WHERE status NOT IN lt_status.
        WHEN 'Started'.
          io_tech_request_context->get_filter( )->convert_select_option(
            EXPORTING is_select_option = ls_filter IMPORTING et_select_option = lt_started ).
          DELETE et_entityset WHERE started NOT IN lt_started.
      ENDCASE.
    ENDLOOP.
    SORT et_entityset BY started DESCENDING run_id DESCENDING.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
    LOOP AT et_entityset ASSIGNING <ls_run>.
      enrich_run( CHANGING cs_run = <ls_run> ).
    ENDLOOP.
  ENDMETHOD.
  METHOD runset_get_entity.
    DATA lv_run_id TYPE zosd_l3_run-run_id.
    DATA ls_stage TYPE zosd_l3_stage.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    SELECT SINGLE * FROM zosd_l3_run INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id.
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM zosd_l3_stage INTO ls_stage
        WHERE set_name = 'fleet2' AND run_id = lv_run_id AND stage_no = 1.
      IF sy-subrc = 0.
        er_entity-run_id = ls_stage-run_id.
        er_entity-check_date = ls_stage-check_date.
        er_entity-set_name = ls_stage-set_name.
        er_entity-started = ls_stage-opened.
        SELECT SINGLE status FROM zosd_l3_stage INTO er_entity-status
          WHERE set_name = 'fleet2' AND run_id = lv_run_id AND stage_no = 2.
      ENDIF.
    ENDIF.
    SELECT SINGLE status FROM zosd_l3_stage INTO er_entity-status
      WHERE set_name = 'fleet2' AND run_id = lv_run_id AND stage_no = 2.
    SELECT SINGLE state FROM zosd_l3_budget INTO er_entity-status
      WHERE set_name = 'fleet2' AND run_id = lv_run_id AND state = 'GLASS'.
    IF er_entity-run_id IS NOT INITIAL.
      enrich_run( CHANGING cs_run = er_entity ).
    ENDIF.
  ENDMETHOD.
  METHOD stageset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_entityset.
    CONCATENATE lv_computed_fields 'STATUS_CRIT' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'StatusCriticality' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_stage INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY stage_no.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
    LOOP AT et_entityset ASSIGNING <ls_row>.
      <ls_row>-status_crit = criticality( <ls_row>-status ).
    ENDLOOP.
  ENDMETHOD.
  METHOD stageset_get_entity.
    DATA lv_run_id TYPE zosd_l3_stage-run_id.
    DATA lv_stage_no TYPE zosd_l3_stage-stage_no.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    lv_stage_no = parameter( it_params = it_key_tab iv_name = 'StageNo' ).
    SELECT SINGLE * FROM zosd_l3_stage INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id
        AND stage_no = lv_stage_no.
    er_entity-status_crit = criticality( er_entity-status ).
  ENDMETHOD.
  METHOD pileset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_entityset.
    CONCATENATE lv_computed_fields 'STATUS_CRIT CAN_RELEASE' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'StatusCriticality CanRelease' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_pile INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY stage_no rule_name pile_no.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
    LOOP AT et_entityset ASSIGNING <ls_row>.
      <ls_row>-status_crit = criticality( <ls_row>-status ).
      IF <ls_row>-status = 'HELD'.
        <ls_row>-can_release = abap_true.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD pileset_get_entity.
    DATA lv_run_id TYPE zosd_l3_pile-run_id.
    DATA lv_rule_name TYPE zosd_l3_pile-rule_name.
    DATA lv_pile_no TYPE zosd_l3_pile-pile_no.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    lv_rule_name = parameter( it_params = it_key_tab iv_name = 'RuleName' ).
    lv_pile_no = parameter( it_params = it_key_tab iv_name = 'PileNo' ).
    SELECT SINGLE * FROM zosd_l3_pile INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id
        AND rule_name = lv_rule_name
        AND pile_no = lv_pile_no.
    er_entity-status_crit = criticality( er_entity-status ).
    IF er_entity-status = 'HELD'.
      er_entity-can_release = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD budgetset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    DATA lv_computed_fields TYPE string.
    DATA lv_computed_props TYPE string.
    DATA lo_computed_filter TYPE REF TO /iwbep/if_mgw_req_filter.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_entityset.
    CONCATENATE lv_computed_fields 'STATE_CRIT' INTO lv_computed_fields SEPARATED BY space.
    CONCATENATE lv_computed_props 'StateCriticality' INTO lv_computed_props SEPARATED BY space.
    lo_computed_filter = io_tech_request_context->get_filter( ).
    refuse_computed( iv_where = io_tech_request_context->get_osql_where_clause( ) iv_filter = lo_computed_filter->get_filter_string( )
      it_options = it_filter_select_options it_order = it_order iv_fields = lv_computed_fields iv_properties = lv_computed_props ).
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_budget INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
    LOOP AT et_entityset ASSIGNING <ls_row>.
      <ls_row>-state_crit = criticality( <ls_row>-state ).
    ENDLOOP.
  ENDMETHOD.
  METHOD budgetset_get_entity.
    DATA lv_run_id TYPE zosd_l3_budget-run_id.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    SELECT SINGLE * FROM zosd_l3_budget INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id.
    er_entity-state_crit = criticality( er_entity-state ).
  ENDMETHOD.
  METHOD eventset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_event INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY seq.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD eventset_get_entity.
    DATA lv_run_id TYPE zosd_l3_event-run_id.
    DATA lv_seq TYPE zosd_l3_event-seq.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    lv_seq = parameter( it_params = it_key_tab iv_name = 'Seq' ).
    SELECT SINGLE * FROM zosd_l3_event INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id
        AND seq = lv_seq.
  ENDMETHOD.
  METHOD doctorset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_doctor INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY acted seq.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD doctorset_get_entity.
    DATA lv_run_id TYPE zosd_l3_doctor-run_id.
    DATA lv_seq TYPE zosd_l3_doctor-seq.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    lv_seq = parameter( it_params = it_key_tab iv_name = 'Seq' ).
    SELECT SINGLE * FROM zosd_l3_doctor INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id
        AND seq = lv_seq.
  ENDMETHOD.
  METHOD runstatset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_runstat INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD runstatset_get_entity.
    DATA lv_set_name TYPE zosd_l3_runstat-set_name.
    DATA lv_run_id TYPE zosd_l3_runstat-run_id.
    lv_set_name = parameter( it_params = it_key_tab iv_name = 'SetName' ).
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    SELECT SINGLE * FROM zosd_l3_runstat INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND set_name = lv_set_name
        AND run_id = lv_run_id.
  ENDMETHOD.
  METHOD settingset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    zcl_l3_fleet2=>settings_seed( ).
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    SELECT * FROM zosd_l3_conf INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY param_name.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD settingset_get_entity.
    DATA lv_set_name TYPE zosd_l3_conf-set_name.
    DATA lv_param_name TYPE zosd_l3_conf-param_name.
    lv_set_name = parameter( it_params = it_key_tab iv_name = 'SetName' ).
    lv_param_name = parameter( it_params = it_key_tab iv_name = 'ParamName' ).
    SELECT SINGLE * FROM zosd_l3_conf INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND set_name = lv_set_name
        AND param_name = lv_param_name.
  ENDMETHOD.
  METHOD changeset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    SELECT * FROM zosd_l3_conf_log INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY changed_at DESCENDING.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD changeset_get_entity.
    DATA lv_change_id TYPE zosd_l3_conf_log-change_id.
    lv_change_id = parameter( it_params = it_key_tab iv_name = 'ChangeId' ).
    SELECT SINGLE * FROM zosd_l3_conf_log INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND change_id = lv_change_id.
  ENDMETHOD.
  METHOD confsnapset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    IF it_navigation_path IS NOT INITIAL.
      lv_run = parameter( it_params = it_key_tab iv_name = 'RunId' ).
      REPLACE ALL OCCURRENCES OF '''' IN lv_run WITH ''''''.
      lv_where = |{ lv_where } AND RUN_ID = '{ lv_run }'|.
    ENDIF.
    SELECT * FROM zosd_l3_run_conf INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    SORT et_entityset BY param_name.
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD confsnapset_get_entity.
    DATA lv_run_id TYPE zosd_l3_run_conf-run_id.
    DATA lv_param_name TYPE zosd_l3_run_conf-param_name.
    lv_run_id = parameter( it_params = it_key_tab iv_name = 'RunId' ).
    lv_param_name = parameter( it_params = it_key_tab iv_name = 'ParamName' ).
    SELECT SINGLE * FROM zosd_l3_run_conf INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND run_id = lv_run_id
        AND param_name = lv_param_name.
  ENDMETHOD.
  METHOD snapshotset_get_entityset.
    DATA lv_where TYPE string.
    DATA lv_filter TYPE string.
    DATA lv_run TYPE string.
    DATA lv_count TYPE i.
    " the set first: a dynamic condition starts with a column on a system
    " ('1 = 1' parses here and not there), and the OData filter only joins
    " when there is one
    lv_where = |SET_NAME = 'fleet2'|.
    lv_filter = io_tech_request_context->get_osql_where_clause( ).
    IF lv_filter IS NOT INITIAL.
      lv_where = |{ lv_where } AND ( { lv_filter } )|.
    ENDIF.
    SELECT * FROM zosd_l3_snap INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE (lv_where).
    es_response_context-inlinecount = lines( et_entityset ).
    IF is_paging-skip > 0.
      DELETE et_entityset FROM 1 TO is_paging-skip.
    ENDIF.
    IF is_paging-top > 0 AND lines( et_entityset ) > is_paging-top.
      lv_count = is_paging-top + 1.
      DELETE et_entityset FROM lv_count.
    ENDIF.
  ENDMETHOD.
  METHOD snapshotset_get_entity.
    DATA lv_snap_id TYPE zosd_l3_snap-snap_id.
    lv_snap_id = parameter( it_params = it_key_tab iv_name = 'SnapId' ).
    SELECT SINGLE * FROM zosd_l3_snap INTO CORRESPONDING FIELDS OF er_entity
      WHERE set_name = 'fleet2'
        AND snap_id = lv_snap_id.
  ENDMETHOD.
  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    DATA lx_error TYPE REF TO cx_root.
    DATA lv_text TYPE string.
    DATA ls_answer TYPE zcl_zl3c_fleet2_mpc=>ts_answer.
    DATA ls_run TYPE zcl_l3_fleet2=>ty_result.
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
    DATA ls_unschedule TYPE zcl_l3_fleet2=>ty_unschedule.
    DATA lt_report TYPE zcl_l3_fleet2=>tt_doctor.
    DATA ls_report TYPE zcl_l3_fleet2=>ty_doctor.
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
          WHEN 'StartRun'.
            IF lv_work IS NOT INITIAL.
              lv_work = |work={ lv_work }|.
            ENDIF.
            ls_run = zcl_l3_fleet2=>run( iv_date = lv_date iv_mode = lv_mode iv_bind = lv_work ).
            ls_answer-run_id = ls_run-run_id.
            ls_answer-answer = ls_run-status.
            IF ls_run-status = 'SUBMITTED'.
              ls_answer-answer = ls_answer-answer && ': background jobs carry the piles (on open-steamgate they need node tools/osd-batch-runs.mjs worker)'.
            ENDIF.
          WHEN 'ReleasePile'.
            lv_ok = zcl_l3_fleet2=>release_pile( iv_run = lv_run iv_rule = lv_rule iv_pile = lv_pile iv_per_pile = lv_cap iv_reason = lv_reason ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: ReleasePile: the pile is not HELD, the run or its budget does not allow a release (GLASS, not open), the per-pile cap is lowered, the pile is locked, or the reason is empty or over 80 characters'.
            ENDIF.
          WHEN 'ContinueGlass'.
            lv_ok = zcl_l3_fleet2=>continue_glass( iv_run = lv_run iv_new_glass = lv_glass iv_reason = lv_reason ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: ContinueGlass: the run is not at GLASS, the new glass is not above the current one, or the reason is empty or over 80 characters'.
            ENDIF.
          WHEN 'Resume'.
            lt_report = zcl_l3_fleet2=>resume( iv_run = lv_run ).
            LOOP AT lt_report INTO ls_report.
              ls_answer-answer = ls_answer-answer && ls_report-doc_action && ':' && ls_report-reason && cl_abap_char_utilities=>newline.
            ENDLOOP.
          WHEN 'Doctor'.
            lt_report = zcl_l3_fleet2=>doctor(  ).
            LOOP AT lt_report INTO ls_report.
              ls_answer-answer = ls_answer-answer && ls_report-doc_action && ':' && ls_report-reason && cl_abap_char_utilities=>newline.
            ENDLOOP.
          WHEN 'StartDaemon'.
            lv_ok = zcl_l3_fleet2=>start_daemon(  ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: StartDaemon: the runner declined it'.
            ENDIF.
          WHEN 'StopDaemon'.
            lv_ok = zcl_l3_fleet2=>stop_daemon(  ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: StopDaemon: the runner declined it'.
            ENDIF.
          WHEN 'SetKill'.
            lv_ok = zcl_l3_fleet2=>set_kill( iv_reason = lv_reason ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: SetKill: the reason is empty or over 80 characters'.
            ENDIF.
          WHEN 'ClearKill'.
            lv_ok = zcl_l3_fleet2=>clear_kill( iv_reason = lv_reason ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: ClearKill: the reason is empty or over 80 characters'.
            ENDIF.
          WHEN 'SetSetting'.
            lv_ok = zcl_l3_fleet2=>set_setting( iv_param = lv_param iv_value = lv_value iv_note = lv_note ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: SetSetting: unknown setting, a value outside its range, budget.warn above budget.narrow_at, simulate dump + hang + slow above 1000, or the note is empty or over 80 characters'.
            ENDIF.
          WHEN 'ResetSetting'.
            lv_ok = zcl_l3_fleet2=>cockpit_reset_setting( iv_param = lv_param iv_note = lv_note ).
            IF lv_ok = abap_true.
              ls_answer-answer = 'OK'.
            ELSE.
              ls_answer-answer = 'REFUSED: ResetSetting: unknown setting, or the note is empty or over 80 characters'.
            ENDIF.
          WHEN 'Schedule'.
            ls_answer-answer = zcl_l3_fleet2=>schedule( ).
          WHEN 'Unschedule'.
            ls_unschedule = zcl_l3_fleet2=>unschedule( ).
            ls_answer-answer = |deleted { ls_unschedule-deleted }, refused { ls_unschedule-refused }|.
          WHEN 'ScheduleStatus'.
            ls_answer-answer = zcl_l3_fleet2=>cockpit_schedule_status( ).
            ls_answer-answer = ls_answer-answer && ' / ' && zcl_l3_fleet2=>daemon_status( ).
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
