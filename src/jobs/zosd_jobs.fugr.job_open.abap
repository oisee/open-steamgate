FUNCTION job_open.
*" IMPORTING JOBNAME TYPE STRING
*" EXPORTING JOBCOUNT TYPE STRING
*" EXCEPTIONS JOBNAME_MISSING CANT_CREATE_JOB
  DATA lv_error TYPE string.
  DATA lv_jobname TYPE string.
  DATA lv_candidate TYPE string.
  DATA lv_insert_subrc TYPE i.
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
    lv_insert_subrc = sy-subrc.
    lv_candidate = jobcount.
    CLEAR jobcount.
*   The private candidate must not outlive a failed reservation, even when
*   the caller catches CANT_CREATE_JOB and continues in the same LUW.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'CANCEL' iv_jobname = jobname
                iv_jobcount = lv_candidate iv_owner = sy-uname iv_client = sy-mandt
      IMPORTING ev_error = lv_error.
    IF lv_error IS NOT INITIAL OR lv_insert_subrc <> 4.
      RAISE cant_create_job.
    ENDIF.
*   The file client reports any INSERT SQL error as subrc 4. Retry only
*   when this exact business key exists, not after an unrelated failure.
    SELECT SINGLE * FROM zosd_job_identity INTO ls_existing
      WHERE mandt = sy-mandt AND jobname = lv_jobname AND jobcount = lv_candidate.
    IF sy-subrc <> 0.
      RAISE cant_create_job.
    ENDIF.
  ENDDO.
  RAISE cant_create_job.
ENDFUNCTION.
