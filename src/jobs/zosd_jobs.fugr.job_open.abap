FUNCTION job_open.
*" IMPORTING JOBNAME TYPE STRING
*" EXPORTING JOBCOUNT TYPE STRING
*" EXCEPTIONS JOBNAME_MISSING CANT_CREATE_JOB
  DATA lv_error TYPE string.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'OPEN' iv_jobname = jobname
              iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_jobcount = jobcount ev_error = lv_error.
  IF lv_error IS NOT INITIAL.
    RAISE cant_create_job.
  ENDIF.
ENDFUNCTION.
