FUNCTION job_close.
*" IMPORTING JOBNAME JOBCOUNT STRTIMMED SDLSTRTDT SDLSTRTTM TARGETSYSTEM PRED_JOBNAME PRED_JOBCOUNT PREDJOB_CHECKSTAT EVENT_ID EVENT_PARAM EVENT_PERIODIC TAIL_EVENT_ID TAIL_EVENT_PARAM
*" EXPORTING JOB_WAS_RELEASED
*" EXCEPTIONS JOBNAME_MISSING JOB_NOTEX JOB_CLOSE_FAILED
  DATA lv_error TYPE string.
  DATA lv_intent TYPE string.
  DATA lv_program TYPE string.
  DATA lv_input_json TYPE string.
  DATA lv_generation TYPE string.
  DATA lv_source TYPE string.
  DATA lv_step_count TYPE string.
  DATA lv_step_no TYPE string.
  DATA lv_jobname TYPE string.
  DATA lv_pred_intent TYPE string.
  DATA lv_pred_name TYPE string.
  DATA lv_requested_name TYPE string.
  DATA lv_pred_state TYPE string.
  DATA lv_event_name TYPE string.
  DATA lv_tail_name TYPE string.
  DATA lv_source_instance TYPE string.
  DATA lv_signal_seq TYPE string.
  DATA lv_step_index TYPE i.
  DATA ls_intent TYPE zosd_job_outbox.
  DATA lv_release TYPE zosd_job_outbox-release_seq.
  DATA ls_step TYPE zosd_job_step.
  DATA lv_timed TYPE abap_bool.
  DATA lv_periodic TYPE abap_bool.
  DATA lv_sdl_date TYPE string.
  DATA lv_sdl_time TYPE string.
  DATA lv_last_date TYPE string.
  DATA lv_last_time TYPE string.
  DATA lv_now TYPE string.
  DATA lv_now_time TYPE string.
  DATA lv_sdl TYPE string.
  DATA lv_last TYPE string.
  DATA lv_prd_mins TYPE string.
  DATA lv_prd_hours TYPE string.
  DATA lv_prd_days TYPE string.
  DATA lv_prd_weeks TYPE string.
  DATA lv_message TYPE string.
  DATA lv_year TYPE i.
  DATA lv_month TYPE i.
  DATA lv_day TYPE i.
  DATA lv_last_day TYPE i.
  CLEAR job_was_released.
  ret = 0.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  lv_pred_name = pred_jobname.
  CONDENSE lv_pred_name.
  TRANSLATE lv_pred_name TO UPPER CASE.
  lv_requested_name = jobname.
  CONDENSE lv_requested_name.
  TRANSLATE lv_requested_name TO UPPER CASE.
  lv_event_name = event_id.
  CONDENSE lv_event_name.
  TRANSLATE lv_event_name TO UPPER CASE.
  lv_tail_name = tail_event_id.
  CONDENSE lv_tail_name.
  TRANSLATE lv_tail_name TO UPPER CASE.
  IF lv_tail_name IS INITIAL AND tail_event_param IS NOT INITIAL.
    RAISE job_close_failed.
  ENDIF.
  IF lv_tail_name IS NOT INITIAL.
    IF strlen( lv_tail_name ) > 32 OR strlen( tail_event_param ) > 64
        OR lv_tail_name CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'
        OR lv_tail_name+0(1) CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.
      RAISE job_close_failed.
    ENDIF.
  ENDIF.
* Start by date and time, measured on the sandbox 2026-10-01: the values
* are system time (sy-datum/sy-uzeit, UTC here), a start in the past is
* rewritten to the close time, and a past start whose latest start time
* has also passed is refused with BT 386 before anything is released.
* A caller passing typed fields hands over '00000000' for an initial date;
* a time of zeros means midnight only when a date is given.
  lv_sdl_date = sdlstrtdt.
  lv_sdl_time = sdlstrttm.
  lv_last_date = laststrtdt.
  lv_last_time = laststrttm.
  IF lv_sdl_date CO '0 '.
    CLEAR lv_sdl_date.
  ENDIF.
  IF lv_sdl_date IS INITIAL AND lv_sdl_time CO '0 '.
    CLEAR lv_sdl_time.
  ENDIF.
  IF lv_last_date CO '0 '.
    CLEAR lv_last_date.
  ENDIF.
  IF lv_last_date IS INITIAL AND lv_last_time CO '0 '.
    CLEAR lv_last_time.
  ENDIF.
  IF lv_sdl_date IS NOT INITIAL OR lv_sdl_time IS NOT INITIAL.
    lv_timed = abap_true.
    IF lv_sdl_time IS INITIAL.
      lv_sdl_time = '000000'.
    ENDIF.
    IF lv_sdl_date IS INITIAL.
      RAISE invalid_startdate.
    ENDIF.
  ELSEIF lv_last_date IS NOT INITIAL OR lv_last_time IS NOT INITIAL.
    RAISE invalid_startdate.
  ENDIF.
  IF lv_timed = abap_true AND ( lv_last_date IS NOT INITIAL OR lv_last_time IS NOT INITIAL ).
    IF lv_last_date IS INITIAL.
      RAISE invalid_startdate.
    ENDIF.
    IF lv_last_time IS INITIAL.
      lv_last_time = '000000'.
    ENDIF.
  ENDIF.
  IF lv_timed = abap_true.
    DO 2 TIMES.
      IF sy-index = 1.
        lv_sdl = lv_sdl_date && lv_sdl_time.
      ELSEIF lv_last_date IS INITIAL.
        EXIT.
      ELSE.
        lv_sdl = lv_last_date && lv_last_time.
      ENDIF.
      IF strlen( lv_sdl ) <> 14 OR lv_sdl CN '0123456789'.
        RAISE invalid_startdate.
      ENDIF.
      lv_year = lv_sdl+0(4).
      lv_month = lv_sdl+4(2).
      lv_day = lv_sdl+6(2).
      IF lv_year < 1 OR lv_month < 1 OR lv_month > 12 OR lv_day < 1
          OR lv_sdl+8(2) > '23' OR lv_sdl+10(2) > '59' OR lv_sdl+12(2) > '59'.
        RAISE invalid_startdate.
      ENDIF.
      CASE lv_month.
        WHEN 4 OR 6 OR 9 OR 11.
          lv_last_day = 30.
        WHEN 2.
          lv_last_day = 28.
          IF lv_year MOD 4 = 0 AND ( lv_year MOD 100 <> 0 OR lv_year MOD 400 = 0 ).
            lv_last_day = 29.
          ENDIF.
        WHEN OTHERS.
          lv_last_day = 31.
      ENDCASE.
      IF lv_day > lv_last_day.
        RAISE invalid_startdate.
      ENDIF.
    ENDDO.
    lv_sdl = lv_sdl_date && lv_sdl_time.
    IF lv_last_date IS NOT INITIAL.
      lv_last = lv_last_date && lv_last_time.
    ENDIF.
  ENDIF.
* Periods in minutes, hours, days and weeks. Months stay refused: calendar
* months need end-of-month rules nobody has measured yet.
  lv_prd_mins = prdmins.
  lv_prd_hours = prdhours.
  lv_prd_days = prddays.
  lv_prd_weeks = prdweeks.
  IF lv_prd_mins CN '0123456789' OR strlen( lv_prd_mins ) > 2
      OR lv_prd_hours CN '0123456789' OR strlen( lv_prd_hours ) > 2
      OR lv_prd_days CN '0123456789' OR strlen( lv_prd_days ) > 3
      OR lv_prd_weeks CN '0123456789' OR strlen( lv_prd_weeks ) > 2.
    RAISE job_close_failed.
  ENDIF.
  IF lv_prd_mins CN '0' OR lv_prd_hours CN '0' OR lv_prd_days CN '0' OR lv_prd_weeks CN '0'.
    lv_periodic = abap_true.
  ENDIF.
  IF lv_periodic = abap_true AND lv_timed = abap_false.
    RAISE job_close_failed.
  ENDIF.
  IF lv_timed = abap_true AND ( strtimmed IS NOT INITIAL OR lv_event_name IS NOT INITIAL
      OR event_param IS NOT INITIAL OR lv_pred_name IS NOT INITIAL
      OR pred_jobcount IS NOT INITIAL OR predjob_checkstat IS NOT INITIAL ).
    RAISE job_close_failed.
  ENDIF.
  IF lv_timed = abap_true.
    GET TIME.
    lv_now = sy-datum.
    lv_now_time = sy-uzeit.
    lv_now = lv_now && lv_now_time.
    IF lv_sdl < lv_now.
      IF lv_last IS NOT INITIAL AND lv_last < lv_now.
        MESSAGE ID 'BT' TYPE 'E' NUMBER '386' INTO lv_message.
        RAISE invalid_startdate.
      ENDIF.
      lv_sdl = lv_now.
    ENDIF.
    IF lv_last IS NOT INITIAL AND lv_last < lv_sdl.
      RAISE invalid_startdate.
    ENDIF.
  ENDIF.
  IF targetsystem IS NOT INITIAL OR targetserver IS NOT INITIAL
      OR targetgroup IS NOT INITIAL.
    RAISE invalid_target.
  ENDIF.
  IF time_zone IS NOT INITIAL.
    RAISE invalid_time_zone.
  ENDIF.
  IF targetsystem IS NOT INITIAL OR event_periodic IS NOT INITIAL
      OR at_opmode IS NOT INITIAL OR at_opmode_periodic IS NOT INITIAL
      OR calendar_id IS NOT INITIAL
      OR prdmonths IS NOT INITIAL
      OR startdate_restriction IS NOT INITIAL
      OR start_on_workday_not_before IS NOT INITIAL
      OR start_on_workday_nr IS NOT INITIAL OR workday_count_direction IS NOT INITIAL
      OR recipient_obj IS NOT INITIAL OR targetserver IS NOT INITIAL
      OR targetgroup IS NOT INITIAL OR inherit_recipient IS NOT INITIAL
      OR inherit_target IS NOT INITIAL OR register_child IS NOT INITIAL
      OR email_notification IS NOT INITIAL OR time_zone IS NOT INITIAL
      OR dont_release IS NOT INITIAL OR direct_start IS NOT INITIAL.
    RAISE job_close_failed.
  ENDIF.
  IF lv_event_name IS NOT INITIAL.
    IF strtimmed IS NOT INITIAL OR lv_pred_name IS NOT INITIAL
        OR pred_jobcount IS NOT INITIAL OR predjob_checkstat IS NOT INITIAL
        OR strlen( lv_event_name ) > 32 OR strlen( event_param ) > 64.
      RAISE job_close_failed.
    ENDIF.
  ELSEIF lv_timed = abap_true.
*   Combinations were refused above; the start condition is the time.
  ELSEIF lv_pred_name IS INITIAL AND pred_jobcount IS INITIAL
      AND predjob_checkstat IS INITIAL.
    IF strtimmed <> 'X' OR event_param IS NOT INITIAL.
      RAISE job_close_failed.
    ENDIF.
  ELSE.
    IF strtimmed IS NOT INITIAL OR lv_pred_name IS INITIAL
        OR pred_jobcount IS INITIAL OR predjob_checkstat <> 'X'
        OR event_param IS NOT INITIAL
        OR lv_pred_name = lv_requested_name AND pred_jobcount = jobcount.
      RAISE job_close_failed.
    ENDIF.
    SELECT SINGLE intent_id FROM zosd_job_identity INTO lv_pred_intent
      WHERE mandt = sy-mandt AND jobname = lv_pred_name
        AND jobcount = pred_jobcount AND owner = sy-uname.
    IF sy-subrc <> 0 OR lv_pred_intent IS INITIAL.
      RAISE job_close_failed.
    ENDIF.
    CALL FUNCTION 'ZOSD_JOB_STATUS'
      EXPORTING iv_jobname = lv_pred_name iv_jobcount = pred_jobcount
      IMPORTING ev_state = lv_pred_state
      EXCEPTIONS uncommitted = 1 OTHERS = 2.
    IF sy-subrc > 1.
      RAISE job_close_failed.
    ENDIF.
    IF sy-subrc = 0 AND ( lv_pred_state = 'COMPLETED'
        OR lv_pred_state = 'FAILED' OR lv_pred_state = 'INTERRUPTED' ).
      RAISE job_close_failed.
    ENDIF.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'CLOSE' iv_jobname = jobname
              iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
              iv_event_id = lv_event_name
    IMPORTING ev_intent_id = lv_intent ev_jobname = lv_jobname ev_program = lv_program
              ev_step_count = lv_step_count
              ev_generation = lv_generation ev_source_db = lv_source
              ev_source_instance = lv_source_instance ev_signal_seq = lv_signal_seq
              ev_error = lv_error.
  IF lv_error = 'Job definition not found in this LUW'.
    RAISE job_notex.
  ENDIF.
  IF lv_error = 'Job has no open report steps'.
    RAISE job_nosteps.
  ENDIF.
  IF lv_error IS NOT INITIAL OR lv_intent IS INITIAL OR lv_jobname IS INITIAL
      OR lv_source_instance IS INITIAL.
    RAISE job_close_failed.
  ENDIF.
  ls_intent-mandt = sy-mandt.
  ls_intent-intent_id = lv_intent.
  ls_intent-sysid = sy-sysid.
  ls_intent-source_db = lv_source.
  ls_intent-source_instance = lv_source_instance.
  ls_intent-jobname = lv_jobname.
  ls_intent-jobcount = jobcount.
  ls_intent-owner = sy-uname.
  ls_intent-program = lv_program.
  ls_intent-step_count = lv_step_count.
  ls_intent-generation = lv_generation.
  ls_intent-pred_jobname = lv_pred_name.
  ls_intent-pred_jobcount = pred_jobcount.
  ls_intent-pred_intent_id = lv_pred_intent.
  ls_intent-event_id = lv_event_name.
  ls_intent-event_param = event_param.
  ls_intent-tail_event_id = lv_tail_name.
  ls_intent-tail_event_param = tail_event_param.
  IF lv_event_name IS NOT INITIAL.
    ls_intent-wait_seq = lv_signal_seq.
  ENDIF.
  ls_intent-created_on = sy-datum.
  ls_intent-created_at = sy-uzeit.
  " the release order: one more than any intent still in the outbox; the
  " drain imports a second's jobs in this order (a deleted row leaves a gap,
  " never a reordering). Tested where the facade runs today, a SQLite file
  SELECT MAX( release_seq ) FROM zosd_job_outbox INTO lv_release
    WHERE mandt = sy-mandt.
  lv_release = lv_release + 1.
  ls_intent-release_seq = lv_release.
  IF lv_timed = abap_true.
    ls_intent-sdlstrtdt = lv_sdl+0(8).
    ls_intent-sdlstrttm = lv_sdl+8(6).
    IF lv_last IS NOT INITIAL.
      ls_intent-laststrtdt = lv_last+0(8).
      ls_intent-laststrttm = lv_last+8(6).
    ENDIF.
    IF lv_periodic = abap_true.
      ls_intent-prdmins = lv_prd_mins.
      ls_intent-prdhours = lv_prd_hours.
      ls_intent-prddays = lv_prd_days.
      ls_intent-prdweeks = lv_prd_weeks.
    ENDIF.
  ENDIF.
  lv_step_index = 1.
  WHILE lv_step_index <= lv_step_count.
    lv_step_no = lv_step_index.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'READ' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                iv_intent_id = lv_intent iv_step_no = lv_step_no
      IMPORTING ev_program = lv_program ev_input_json = lv_input_json
                ev_error = lv_error.
    IF lv_error IS NOT INITIAL OR lv_program IS INITIAL.
      CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
        EXPORTING iv_command = 'ABORT' iv_jobname = jobname
                  iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                  iv_intent_id = lv_intent.
      RAISE job_close_failed.
    ENDIF.
    CLEAR ls_step.
    ls_step-mandt = sy-mandt.
    ls_step-intent_id = lv_intent.
    ls_step-step_no = lv_step_index.
    ls_step-program = lv_program.
    ls_step-input_json = lv_input_json.
    INSERT zosd_job_step FROM ls_step.
    IF sy-subrc <> 0.
      CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
        EXPORTING iv_command = 'ABORT' iv_jobname = jobname
                  iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                  iv_intent_id = lv_intent.
      RAISE job_close_failed.
    ENDIF.
    lv_step_index = lv_step_index + 1.
  ENDWHILE.
  INSERT zosd_job_outbox FROM ls_intent.
  IF sy-subrc <> 0.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'ABORT' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                iv_intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
  UPDATE zosd_job_identity SET intent_id = lv_intent
    WHERE mandt = sy-mandt AND jobname = lv_jobname AND jobcount = jobcount
      AND owner = sy-uname AND intent_id = space.
  IF sy-subrc <> 0 OR sy-dbcnt <> 1.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'ABORT' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                iv_intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'DONE' iv_jobname = jobname
              iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
              iv_intent_id = lv_intent
    IMPORTING ev_error = lv_error.
  IF lv_error IS NOT INITIAL.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'ABORT' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                iv_intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
  job_was_released = 'X'.
ENDFUNCTION.
