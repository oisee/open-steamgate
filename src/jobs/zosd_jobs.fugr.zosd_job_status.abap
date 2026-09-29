FUNCTION zosd_job_status.
*" IMPORTING IV_JOBNAME TYPE STRING IV_JOBCOUNT TYPE STRING
*" EXPORTING EV_PHASE TYPE STRING EV_STATE TYPE STRING
*"           EV_RESULT_STATUS TYPE STRING EV_STEP_COUNT TYPE STRING
*" EXCEPTIONS NOT_FOUND FORBIDDEN INCONSISTENT LEGACY UNCOMMITTED
*"            UNAVAILABLE BAD_KEY
  DATA lv_error TYPE string.
  CLEAR: ev_phase, ev_state, ev_result_status, ev_step_count.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'STATUS' iv_jobname = iv_jobname
              iv_jobcount = iv_jobcount
    IMPORTING ev_phase = ev_phase ev_state = ev_state
              ev_result_status = ev_result_status ev_step_count = ev_step_count
              ev_error_code = lv_error.
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
    WHEN 'BAD_KEY'.
      RAISE bad_key.
    WHEN OTHERS.
      RAISE unavailable.
  ENDCASE.
ENDFUNCTION.
