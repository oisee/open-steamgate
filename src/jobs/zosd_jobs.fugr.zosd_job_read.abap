FUNCTION zosd_job_read.
*" Private per-call snapshot: HEADER, STEP (1..16), or LOG (1..2000).
  DATA lv_error TYPE string.
  CLEAR: ev_phase, ev_state, ev_result_status, ev_step_count,
         ev_log_count, ev_historical_gap, ev_created_on, ev_created_at,
         ev_queued_at, ev_started_at, ev_ended_at, ev_wait_kind,
         ev_wait_jobname, ev_wait_jobcount, ev_wait_event_id, ev_step_number,
         ev_step_program, ev_input_json, ev_step_state, ev_step_started_at, ev_step_ended_at,
         ev_step_result_status, ev_log_sequence, ev_log_step, ev_log_at,
         ev_log_event, ev_log_severity, ev_log_text.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'READ_JOB' iv_jobname = iv_jobname
              iv_jobcount = iv_jobcount iv_item = iv_item iv_index = iv_index
    IMPORTING
              ev_phase = ev_phase ev_state = ev_state
              ev_result_status = ev_result_status ev_step_count = ev_step_count
              ev_log_count = ev_log_count ev_historical_gap = ev_historical_gap
              ev_created_on = ev_created_on ev_created_at = ev_created_at
              ev_queued_at = ev_queued_at ev_started_at = ev_started_at
              ev_ended_at = ev_ended_at ev_wait_kind = ev_wait_kind
              ev_wait_jobname = ev_wait_jobname ev_wait_jobcount = ev_wait_jobcount
              ev_wait_event_id = ev_wait_event_id ev_step_number = ev_step_number
              ev_step_program = ev_step_program ev_input_json = ev_input_json
              ev_step_state = ev_step_state
              ev_step_started_at = ev_step_started_at ev_step_ended_at = ev_step_ended_at
              ev_step_result_status = ev_step_result_status ev_log_sequence = ev_log_sequence
              ev_log_step = ev_log_step ev_log_at = ev_log_at
              ev_log_event = ev_log_event ev_log_severity = ev_log_severity
              ev_log_text = ev_log_text ev_error_code = lv_error.
  CASE lv_error.
    WHEN space.
      RETURN.
    WHEN 'NOT_FOUND'.
      RAISE not_found.
    WHEN 'FORBIDDEN'.
      RAISE forbidden.
    WHEN 'INCONSISTENT'.
      RAISE inconsistent.
    WHEN 'LEGACY'.
      RAISE legacy.
    WHEN 'UNCOMMITTED'.
      RAISE uncommitted.
    WHEN 'TOO_LARGE'.
      RAISE too_large.
    WHEN 'BAD_KEY'.
      RAISE bad_key.
    WHEN OTHERS.
      RAISE unavailable.
  ENDCASE.
ENDFUNCTION.
