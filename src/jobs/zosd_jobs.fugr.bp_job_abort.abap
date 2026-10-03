FUNCTION bp_job_abort.
* Narrow abort: only the caller's exact live job, never a name-wide stop.
  DATA lv_error TYPE string.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'ABORT_JOB' iv_jobname = jobname iv_jobcount = jobcount
              iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_error_code = lv_error.
  CASE lv_error.
    WHEN space.
      RETURN.
    WHEN 'NOT_FOUND'.
      RAISE job_does_not_exist.
    WHEN 'FORBIDDEN'.
      RAISE no_abort_authority.
    WHEN 'NOT_RUNNING'.
      RAISE job_not_running.
    WHEN OTHERS.
      RAISE cant_abort_job.
  ENDCASE.
ENDFUNCTION.
