FUNCTION job_open.
*" IMPORTING JOBNAME TYPE STRING
*" EXPORTING JOBCOUNT TYPE STRING
*" EXCEPTIONS JOBNAME_MISSING CANT_CREATE_JOB
  DATA lv_error TYPE string.
  DATA ls_identity TYPE zosd_job_identity.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  DO 64 TIMES.
    CLEAR: jobcount, lv_error.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'OPEN' iv_jobname = jobname
                iv_owner = sy-uname iv_client = sy-mandt
      IMPORTING ev_jobcount = jobcount ev_error = lv_error.
    IF lv_error IS NOT INITIAL OR jobcount IS INITIAL.
      RAISE cant_create_job.
    ENDIF.
    CLEAR ls_identity.
    ls_identity-mandt = sy-mandt.
    ls_identity-jobname = jobname.
    TRANSLATE ls_identity-jobname TO UPPER CASE.
    ls_identity-jobcount = jobcount.
    ls_identity-owner = sy-uname.
    INSERT zosd_job_identity FROM ls_identity.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.
    IF sy-subrc <> 4.
      RAISE cant_create_job.
    ENDIF.
*   Only this transient candidate belongs to CANCEL; a committed reservation
*   is never deleted, including one abandoned by an OPEN without CLOSE.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'CANCEL' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
      IMPORTING ev_error = lv_error.
    IF lv_error IS NOT INITIAL.
      RAISE cant_create_job.
    ENDIF.
  ENDDO.
  RAISE cant_create_job.
ENDFUNCTION.
