FUNCTION job_open.
*" IMPORTING JOBNAME TYPE STRING
*" EXPORTING JOBCOUNT TYPE STRING
*" EXCEPTIONS JOBNAME_MISSING CANT_CREATE_JOB
  DATA lv_error TYPE string.
  DATA lv_jobname TYPE string.
  DATA ls_identity TYPE zosd_job_identity.
  DATA ls_existing TYPE zosd_job_identity.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  DO 64 TIMES.
    CLEAR: jobcount, lv_error, lv_jobname.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'OPEN' iv_jobname = jobname
                iv_owner = sy-uname iv_client = sy-mandt
      IMPORTING ev_jobcount = jobcount ev_jobname = lv_jobname ev_error = lv_error.
    IF lv_error IS NOT INITIAL OR jobcount IS INITIAL OR lv_jobname IS INITIAL.
      RAISE cant_create_job.
    ENDIF.
    CLEAR ls_identity.
    ls_identity-mandt = sy-mandt.
    ls_identity-jobname = lv_jobname.
    ls_identity-jobcount = jobcount.
    ls_identity-owner = sy-uname.
    INSERT zosd_job_identity FROM ls_identity.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.
    IF sy-subrc <> 4.
      RAISE cant_create_job.
    ENDIF.
*   The file client reports any INSERT SQL error as subrc 4. Retry only
*   when this exact business key exists, not after an unrelated failure.
    SELECT SINGLE * FROM zosd_job_identity INTO ls_existing
      WHERE mandt = sy-mandt AND jobname = lv_jobname AND jobcount = jobcount.
    IF sy-subrc <> 0.
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
