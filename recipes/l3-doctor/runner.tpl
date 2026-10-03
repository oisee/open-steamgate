{{#autodoctor}}
  METHOD owns_pile.
    DATA ls_owner TYPE zosd_l3_pile.
    DATA ls_run TYPE zosd_l3_run.
    SELECT SINGLE FOR UPDATE * FROM zosd_l3_pile INTO ls_owner
      WHERE set_name = c_set AND run_id = is_pile-run_id
        AND rule_name = is_pile-rule_name AND pile_no = is_pile-pile_no
        AND attempt = is_pile-attempt AND job_name = is_pile-job_name
        AND job_count = is_pile-job_count AND status = 'RUNNING'.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    SELECT SINGLE * FROM zosd_l3_run INTO ls_run
      WHERE set_name = c_set AND run_id = is_pile-run_id AND status = 'HELD'.
    IF sy-subrc = 0.
      rv_ok = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD watcher_audit.
    DATA lt_report TYPE tt_doctor.
    DATA lv_now TYPE timestamp.
    GET TIME STAMP FIELD lv_now.
    IF iv_action = 'DMN-STOP'.
      UPDATE zosd_l3_watch SET watch_state = 'STOPPED' instance_id = '' WHERE set_name = c_set.
    ENDIF.
    act( EXPORTING iv_run = 'SET' iv_action = iv_action iv_reason = 'set watcher' iv_now = lv_now
      CHANGING ct_report = lt_report ).
  ENDMETHOD.
  METHOD watcher_pass.
    DATA lt_runs TYPE STANDARD TABLE OF zosd_l3_run WITH DEFAULT KEY.
    DATA ls_run TYPE zosd_l3_run.
    DATA lv_work TYPE abap_bool.
    DATA ls_select TYPE btcselect.
    DATA lt_jobs TYPE STANDARD TABLE OF tbtcjob WITH DEFAULT KEY.
    DATA ls_job TYPE tbtcjob.
    DATA lv_count TYPE tbtcjob-jobcount.
    DATA lv_name TYPE tbtcjob-jobname.
{{#killable}}
    IF killed( ) = abap_true.
      RETURN.
    ENDIF.
{{/killable}}
    SELECT * FROM zosd_l3_run INTO TABLE lt_runs WHERE set_name = c_set AND status = 'HELD'.
    IF lt_runs IS INITIAL.
      RETURN.
    ENDIF.
    rv_open = abap_true.
    LOOP AT lt_runs INTO ls_run.
{{#governor}}
      IF budget_state( ls_run-run_id ) = 'GLASS'.
        CONTINUE.
      ENDIF.
{{/governor}}
      lv_work = abap_true.
    ENDLOOP.
    IF lv_work = abap_false.
      RETURN.
    ENDIF.
    lv_name = 'L3_{{set_upper}}_PASS'.
    ls_select-jobname = lv_name.
    ls_select-username = sy-uname.
    ls_select-running = 'X'.
    ls_select-ready = 'X'.
    ls_select-schedul = 'X'.
    CALL FUNCTION 'BP_JOB_SELECT' EXPORTING jobselect_dialog = 'N' jobsel_param_in = ls_select
      TABLES jobselect_joblist = lt_jobs EXCEPTIONS no_jobs_found = 1 OTHERS = 2.
    IF sy-subrc > 1 OR lt_jobs IS NOT INITIAL.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_OPEN' EXPORTING jobname = lv_name
      IMPORTING jobcount = lv_count EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_SUBMIT' EXPORTING jobname = lv_name jobcount = lv_count
      report = '{{autodoctor.doctor_report_upper}}' authcknam = sy-uname EXCEPTIONS OTHERS = 1.
    IF sy-subrc = 0.
      CALL FUNCTION 'JOB_CLOSE' EXPORTING jobname = lv_name jobcount = lv_count
        strtimmed = 'X' EXCEPTIONS OTHERS = 1.
    ENDIF.
  ENDMETHOD.
  METHOD count_runs.
    DATA lt_runs TYPE STANDARD TABLE OF zosd_l3_run WITH DEFAULT KEY.
    DATA ls_run TYPE zosd_l3_run.
    DATA lt_piles TYPE tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_stat TYPE zosd_l3_runstat.
    DATA lt_seconds TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA ls_watch TYPE zosd_l3_watch.
    DATA lv_seconds TYPE i.
    DATA lv_total TYPE p LENGTH 16 DECIMALS 3.
    DATA lv_index TYPE i.
    DATA lv_right TYPE i.
    SELECT * FROM zosd_l3_run INTO TABLE lt_runs WHERE set_name = c_set.
    LOOP AT lt_runs INTO ls_run.
      CLEAR: ls_stat, lt_seconds, lv_total.
      ls_stat-set_name = c_set.
      ls_stat-run_id = ls_run-run_id.
      SELECT * FROM zosd_l3_pile INTO TABLE lt_piles WHERE set_name = c_set AND run_id = ls_run-run_id.
      IF lt_piles IS INITIAL AND ls_run-status = 'RELEASED'.
        CONTINUE.
      ENDIF.
      LOOP AT lt_piles INTO ls_pile.
        CASE ls_pile-status.
          WHEN 'DONE'.
            ls_stat-piles_done = ls_stat-piles_done + 1.
            lv_seconds = cl_abap_tstmp=>subtract( tstmp1 = ls_pile-ended tstmp2 = ls_pile-started ).
            APPEND lv_seconds TO lt_seconds.
            lv_total = lv_total + lv_seconds.
          WHEN 'FAILED' OR 'FUSED'. ls_stat-piles_failed = ls_stat-piles_failed + 1.
          WHEN 'RUNNING'. ls_stat-piles_running = ls_stat-piles_running + 1.
          WHEN 'HELD'. ls_stat-piles_held = ls_stat-piles_held + 1.
        ENDCASE.
      ENDLOOP.
      SORT lt_seconds.
      IF ls_stat-piles_done > 0.
        ls_stat-mean_secs = lv_total / ls_stat-piles_done.
        lv_index = ( ls_stat-piles_done + 1 ) DIV 2.
        READ TABLE lt_seconds INDEX lv_index INTO lv_seconds.
        ls_stat-median_secs = lv_seconds.
        IF ls_stat-piles_done MOD 2 = 0.
          lv_index = lv_index + 1.
          READ TABLE lt_seconds INDEX lv_index INTO lv_right.
          ls_stat-median_secs = ( lv_seconds + lv_right ) / 2.
        ENDIF.
      ENDIF.
      GET TIME STAMP FIELD ls_stat-updated_at.
      MODIFY zosd_l3_runstat FROM ls_stat.
    ENDLOOP.
    SELECT SINGLE * FROM zosd_l3_watch INTO ls_watch WHERE set_name = c_set.
    IF sy-subrc = 0.
      GET TIME STAMP FIELD ls_watch-last_pass.
      SELECT COUNT(*) FROM zosd_l3_doctor INTO ls_watch-healed WHERE set_name = c_set AND doc_action = 'FAILED'.
      MODIFY zosd_l3_watch FROM ls_watch.
    ENDIF.
  ENDMETHOD.
{{/autodoctor}}
{{#daemon}}
  METHOD arm_tick.
    DATA lv_now TYPE timestamp.
    DATA lv_next TYPE timestamp.
    GET TIME STAMP FIELD lv_now.
    lv_next = cl_abap_tstmp=>add( tstmp = lv_now secs = doctor_tick( ) ).
    UPDATE zosd_l3_watch SET next_tick = lv_next WHERE set_name = c_set.
  ENDMETHOD.
  METHOD doctor_tick.
    rv_secs = {{tick}}.
{{#settings.doctor_tick}}
    DATA ls_conf TYPE {{settings.class}}=>ty_state.
    ls_conf = {{settings.class}}=>load( ).
    rv_secs = ls_conf-vals-doctor_tick.
{{/settings.doctor_tick}}
  ENDMETHOD.
  METHOD start_daemon.
    DATA lt_info TYPE STANDARD TABLE OF abap_daemon_info WITH DEFAULT KEY.
    DATA ls_info TYPE abap_daemon_info.
    DATA lv_setup TYPE i.
    DATA lv_id TYPE string.
    DATA ls_watch TYPE zosd_l3_watch.
    ls_watch-set_name = c_set.
    INSERT zosd_l3_watch FROM ls_watch.
    SELECT SINGLE FOR UPDATE * FROM zosd_l3_watch INTO ls_watch WHERE set_name = c_set.
    TRY.
        lt_info = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = '{{daemon_class_upper}}' ).
        LOOP AT lt_info INTO ls_info WHERE name = '{{name}}'.
          rv_ok = abap_true.
          RETURN.
        ENDLOOP.
        cl_abap_daemon_client_manager=>start( EXPORTING i_class_name = '{{daemon_class_upper}}' i_name = '{{name}}'
          IMPORTING e_setup_mode = lv_setup e_instance_id = lv_id ).
        IF lv_setup = 1.
          GET TIME STAMP FIELD ls_watch-started.
          ls_watch-instance_id = lv_id.
          ls_watch-watch_state = 'RUNNING'.
          MODIFY zosd_l3_watch FROM ls_watch.
          watcher_audit( 'DMN-START' ).
          rv_ok = abap_true.
        ENDIF.
      CATCH cx_abap_daemon_error.
    ENDTRY.
  ENDMETHOD.
  METHOD stop_daemon.
    DATA lt_info TYPE STANDARD TABLE OF abap_daemon_info WITH DEFAULT KEY.
    DATA ls_info TYPE abap_daemon_info.
    TRY.
        lt_info = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = '{{daemon_class_upper}}' ).
        LOOP AT lt_info INTO ls_info WHERE name = '{{name}}'.
          cl_abap_daemon_client_manager=>stop( ls_info-instance_id ).
          rv_ok = abap_true.
        ENDLOOP.
      CATCH cx_abap_daemon_error.
    ENDTRY.
  ENDMETHOD.
  METHOD daemon_status.
    DATA ls_watch TYPE zosd_l3_watch.
    SELECT SINGLE * FROM zosd_l3_watch INTO ls_watch WHERE set_name = c_set.
    rv_status = |{ ls_watch-watch_state } since { ls_watch-started } last { ls_watch-last_pass }|.
    rv_status = rv_status && | healed { ls_watch-healed } next { ls_watch-next_tick }|.
  ENDMETHOD.
  METHOD pile_done.
    DATA lt_info TYPE STANDARD TABLE OF abap_daemon_info WITH DEFAULT KEY.
    DATA ls_info TYPE abap_daemon_info.
    DATA lo_handle TYPE REF TO if_abap_daemon_handle.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_pile TYPE string.
    lv_pile = iv_pile.
    TRY.
        lt_info = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = '{{daemon_class_upper}}' ).
        lo_message = cl_ac_message_type_pcp=>create( ).
        lo_message->set_field( i_name = 'cmd' i_value = 'pile done' ).
        lo_message->set_field( i_name = 'run' i_value = iv_run ).
        lo_message->set_field( i_name = 'pile' i_value = lv_pile ).
        LOOP AT lt_info INTO ls_info WHERE name = '{{name}}'.
          lo_handle = cl_abap_daemon_client_manager=>attach( ls_info-instance_id ).
          lo_handle->send( lo_message ).
        ENDLOOP.
      CATCH cx_abap_daemon_error.
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
  ENDMETHOD.
{{/daemon}}
{{#release_event}}
  METHOD release_events.
    DATA lt_piles TYPE tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_run TYPE zosd_l3_run.
    DATA lv_active TYPE i.
    DATA lv_lanes TYPE i.
    DATA lv_param TYPE c LENGTH 64.
    DATA ls_watch TYPE zosd_l3_watch.
{{#governor}}
    DATA ls_budget TYPE zosd_l3_budget.
{{/governor}}
{{#automatic}}
    DATA lt_wp TYPE STANDARD TABLE OF wplist WITH DEFAULT KEY.
    DATA ls_wp TYPE wplist.
    CALL FUNCTION 'TH_WPINFO' TABLES wplist = lt_wp EXCEPTIONS OTHERS = 1.
    LOOP AT lt_wp INTO ls_wp WHERE wp_typ = 'BTC' AND wp_status = 'Wait'.
      lv_lanes = lv_lanes + 1.
    ENDLOOP.
    lv_lanes = lv_lanes * 3 DIV 4.
{{/automatic}}
{{^automatic}}
    lv_lanes = {{lanes}}.
{{/automatic}}
{{#settings.pile_lanes}}
    DATA ls_conf TYPE {{settings.class}}=>ty_state.
    ls_conf = {{settings.class}}=>load( ).
    lv_lanes = ls_conf-vals-piles_lanes.
{{/settings.pile_lanes}}
{{#killable}}
    IF killed( ) = abap_true.
      RETURN.
    ENDIF.
{{/killable}}
    SELECT SINGLE FOR UPDATE * FROM zosd_l3_watch INTO ls_watch WHERE set_name = c_set.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles WHERE set_name = c_set AND reason = 'EVENT-WAIT' ORDER BY PRIMARY KEY.
    SELECT COUNT(*) FROM zosd_l3_pile INTO lv_active WHERE set_name = c_set
      AND ( status = 'RUNNING' OR ( status = 'PLANNED' AND reason = 'EVENT-SENT' ) ).
    LOOP AT lt_piles INTO ls_pile.
      IF lv_active >= lv_lanes.
        EXIT.
      ENDIF.
      SELECT SINGLE FOR UPDATE * FROM zosd_l3_run INTO ls_run WHERE set_name = c_set AND run_id = ls_pile-run_id AND status = 'HELD'.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
{{#governor}}
      SELECT SINGLE * FROM zosd_l3_budget INTO ls_budget WHERE set_name = c_set AND run_id = ls_pile-run_id.
      IF ls_budget-state = 'GLASS' OR ( ls_budget-state = 'NARROW' AND lv_active > 0 ).
        CONTINUE.
      ENDIF.
{{/governor}}
      UPDATE zosd_l3_pile SET reason = 'EVENT-SENT' WHERE set_name = c_set AND run_id = ls_pile-run_id
        AND rule_name = ls_pile-rule_name AND pile_no = ls_pile-pile_no AND status = 'PLANNED' AND reason = 'EVENT-WAIT'.
      IF sy-dbcnt <> 1.
        CONTINUE.
      ENDIF.
      lv_param = |{ ls_pile-job_name }/{ ls_pile-job_count }|.
      CALL FUNCTION 'BP_EVENT_RAISE' EXPORTING eventid = 'ZOSD_L3_RELEASE' eventparm = lv_param EXCEPTIONS OTHERS = 1.
      IF sy-subrc <> 0.
        UPDATE zosd_l3_pile SET reason = 'EVENT-WAIT' WHERE set_name = c_set AND run_id = ls_pile-run_id
          AND rule_name = ls_pile-rule_name AND pile_no = ls_pile-pile_no AND status = 'PLANNED' AND reason = 'EVENT-SENT'.
      ELSE.
        lv_active = lv_active + 1.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
{{/release_event}}
{{#autodoctor}}
{{#arm_job}}
  METHOD arm_doctor_job.
    DATA lv_name TYPE tbtcjob-jobname.
    DATA lv_count TYPE tbtcjob-jobcount.
    DATA ls_select TYPE btcselect.
    DATA lt_jobs TYPE STANDARD TABLE OF tbtcjob WITH DEFAULT KEY.
    DATA lv_date TYPE d.
    DATA lv_time TYPE t.
    lv_name = 'L3_{{set_upper}}_DOC'.
    ls_select-jobname = lv_name.
    ls_select-username = sy-uname.
    ls_select-schedul = 'X'.
    CALL FUNCTION 'BP_JOB_SELECT' EXPORTING jobselect_dialog = 'N' jobsel_param_in = ls_select
      TABLES jobselect_joblist = lt_jobs EXCEPTIONS OTHERS = 1.
    IF lt_jobs IS NOT INITIAL.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_OPEN' EXPORTING jobname = lv_name IMPORTING jobcount = lv_count EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_SUBMIT' EXPORTING jobname = lv_name jobcount = lv_count
      report = '{{doctor_report_upper}}' authcknam = sy-uname EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    GET TIME.
    lv_date = sy-datum.
    lv_time = sy-uzeit.
    CALL FUNCTION 'JOB_CLOSE' EXPORTING jobname = lv_name jobcount = lv_count
      sdlstrtdt = lv_date sdlstrttm = lv_time prdmins = {{every}} EXCEPTIONS OTHERS = 1.
  ENDMETHOD.
{{/arm_job}}
{{/autodoctor}}
{{#autodoctor}}
{{#wake_retry}}
  METHOD arm_retry.
    DATA lt_piles TYPE tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_run TYPE zosd_l3_run.
    DATA lv_wait TYPE i.
    DATA lv_times TYPE i.
    DATA lv_due TYPE timestamp.
    DATA lv_first TYPE timestamp.
    DATA lv_text TYPE n LENGTH 14.
    DATA lv_date TYPE d.
    DATA lv_time TYPE t.
    DATA lv_name TYPE tbtcjob-jobname.
    DATA lv_count TYPE tbtcjob-jobcount.
    DATA ls_select TYPE btcselect.
    DATA lt_jobs TYPE STANDARD TABLE OF tbtcjob WITH DEFAULT KEY.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles WHERE set_name = c_set AND status = 'FAILED'.
    LOOP AT lt_piles INTO ls_pile.
      IF ls_pile-attempt > {{#settings.retry_max}}gs_settings-vals-retry_max{{/settings.retry_max}}{{^settings.retry_max}}c_retry_max{{/settings.retry_max}}.
        CONTINUE.
      ENDIF.
      SELECT SINGLE * FROM zosd_l3_run INTO ls_run WHERE set_name = c_set AND run_id = ls_pile-run_id AND status = 'HELD'.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      lv_wait = {{#settings.retry_backoff}}gs_settings-vals-retry_backoff{{/settings.retry_backoff}}{{^settings.retry_backoff}}c_backoff{{/settings.retry_backoff}}.
      lv_times = ls_pile-attempt - 1.
      WHILE lv_times > 0 AND lv_wait < 604800.
        lv_wait = lv_wait * 2.
        lv_times = lv_times - 1.
      ENDWHILE.
      IF lv_wait > 604800.
        lv_wait = 604800.
      ENDIF.
      lv_due = cl_abap_tstmp=>add( tstmp = ls_pile-ended secs = lv_wait ).
      IF lv_first IS INITIAL OR lv_due < lv_first.
        lv_first = lv_due.
      ENDIF.
    ENDLOOP.
    IF lv_first IS INITIAL.
      RETURN.
    ENDIF.
    lv_name = 'L3_{{set_upper}}_RETRY'.
    ls_select-jobname = lv_name.
    ls_select-username = sy-uname.
    ls_select-schedul = 'X'.
    CALL FUNCTION 'BP_JOB_SELECT' EXPORTING jobselect_dialog = 'N' jobsel_param_in = ls_select
      TABLES jobselect_joblist = lt_jobs EXCEPTIONS OTHERS = 1.
    IF lt_jobs IS NOT INITIAL.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_OPEN' EXPORTING jobname = lv_name IMPORTING jobcount = lv_count EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_SUBMIT' EXPORTING jobname = lv_name jobcount = lv_count
      report = '{{doctor_report_upper}}' authcknam = sy-uname EXCEPTIONS OTHERS = 1.
    IF sy-subrc = 0.
      lv_text = lv_first.
      lv_date = lv_text(8).
      lv_time = lv_text+8(6).
      CALL FUNCTION 'JOB_CLOSE' EXPORTING jobname = lv_name jobcount = lv_count
        sdlstrtdt = lv_date sdlstrttm = lv_time EXCEPTIONS OTHERS = 1.
    ENDIF.
  ENDMETHOD.
{{/wake_retry}}
{{/autodoctor}}
