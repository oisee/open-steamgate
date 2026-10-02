FUNCTION bp_job_delete.
* Deletes one job of the caller that is not running: a released job still
* waiting for its start (S), one still in the outbox or in the caller's own
* LUW, an opened job (P), or a finished or aborted one. Measured on the
* sandbox 2026-10-01/02: deleting the waiting successor of a periodic job
* ends the chain; a job scheduled, committed and deleted in the same run
* is gone at once (rc 0), and so is one not yet committed; a released job
* without a start condition is Y at once and refused like a running one.
* COMMITMODE (default 'X') ends with COMMIT WORK, which commits the
* caller's other work too; on a system COMMITMODE = space leaves the
* delete in the caller's LUW. Here an omitted COMMITMODE cannot be told
* from a space: the transpiler neither applies a function module
* parameter's DEFAULT nor answers IS SUPPLIED for one (ANORMALIES.md,
* fm-is-supplied), so the default applies always.
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
      COMMIT WORK.
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
