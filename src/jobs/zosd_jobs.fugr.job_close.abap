FUNCTION job_close.
*" IMPORTING JOBNAME JOBCOUNT STRTIMMED SDLSTRTDT SDLSTRTTM TARGETSYSTEM
*" EXPORTING JOB_WAS_RELEASED
*" EXCEPTIONS JOBNAME_MISSING JOB_NOTEX JOB_CLOSE_FAILED
  DATA lv_error TYPE string.
  DATA lv_intent TYPE string.
  DATA lv_program TYPE string.
  DATA lv_generation TYPE string.
  DATA lv_source TYPE string.
  DATA ls_intent TYPE zosd_job_outbox.
  CLEAR job_was_released.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  IF strtimmed <> 'X' OR sdlstrtdt IS NOT INITIAL OR sdlstrttm IS NOT INITIAL
      OR targetsystem IS NOT INITIAL.
    RAISE job_close_failed.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'CLOSE' iv_jobname = jobname
              iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_intent_id = lv_intent ev_program = lv_program
              ev_generation = lv_generation ev_source_db = lv_source
              ev_error = lv_error.
  IF lv_error = 'Job definition not found in this LUW'.
    RAISE job_notex.
  ENDIF.
  IF lv_error IS NOT INITIAL OR lv_intent IS INITIAL.
    RAISE job_close_failed.
  ENDIF.
  ls_intent-mandt = sy-mandt.
  ls_intent-intent_id = lv_intent.
  ls_intent-sysid = sy-sysid.
  ls_intent-source_db = lv_source.
  ls_intent-jobname = jobname.
  ls_intent-jobcount = jobcount.
  ls_intent-owner = sy-uname.
  ls_intent-program = lv_program.
  ls_intent-generation = lv_generation.
  ls_intent-created_on = sy-datum.
  ls_intent-created_at = sy-uzeit.
  INSERT zosd_job_outbox FROM ls_intent.
  IF sy-subrc <> 0.
    RAISE job_close_failed.
  ENDIF.
  job_was_released = 'X'.
ENDFUNCTION.
