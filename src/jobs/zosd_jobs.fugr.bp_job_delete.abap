FUNCTION bp_job_delete.
* Deletes one job of the caller that is not running: a released job still
* waiting for its start time (S), or a finished or aborted one. Measured on
* the sandbox 2026-10-01: deleting the waiting successor of a periodic job
* ends the chain. Like BP_EVENT_RAISE, the delete reaches the operations
* store at once and is not undone by a later ROLLBACK WORK of the caller.
  DATA lv_error TYPE string.
  ret = 0.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  IF jobcount IS INITIAL.
    RAISE jobcount_missing.
  ENDIF.
  IF forcedmode IS NOT INITIAL.
    RAISE cant_delete_job.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'DELETE' iv_jobname = jobname iv_jobcount = jobcount
              iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_error_code = lv_error.
  CASE lv_error.
    WHEN space.
      RETURN.
    WHEN 'NOT_FOUND'.
      RAISE job_does_not_exist.
    WHEN 'FORBIDDEN'.
      RAISE no_delete_authority.
    WHEN 'RUNNING'.
      RAISE job_is_already_running.
    WHEN OTHERS.
      RAISE cant_delete_job.
  ENDCASE.
ENDFUNCTION.
