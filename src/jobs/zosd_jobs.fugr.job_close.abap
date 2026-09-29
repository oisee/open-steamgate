FUNCTION job_close.
*" IMPORTING JOBNAME JOBCOUNT STRTIMMED SDLSTRTDT SDLSTRTTM TARGETSYSTEM
*" EXPORTING JOB_WAS_RELEASED
*" EXCEPTIONS JOBNAME_MISSING JOB_NOTEX JOB_CLOSE_FAILED
  DATA lv_error TYPE string.
  DATA lv_intent TYPE string.
  DATA lv_program TYPE string.
  DATA lv_generation TYPE string.
  DATA lv_source TYPE string.
  DATA lv_step_count TYPE string.
  DATA lv_step_no TYPE string.
  DATA lv_jobname TYPE string.
  DATA lv_step_index TYPE i.
  DATA ls_intent TYPE zosd_job_outbox.
  DATA ls_step TYPE zosd_job_step.
  CLEAR job_was_released.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  lv_jobname = jobname.
  TRANSLATE lv_jobname TO UPPER CASE.
  IF strtimmed <> 'X' OR sdlstrtdt IS NOT INITIAL OR sdlstrttm IS NOT INITIAL
      OR targetsystem IS NOT INITIAL.
    RAISE job_close_failed.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'CLOSE' iv_jobname = jobname
              iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_intent_id = lv_intent ev_program = lv_program
              ev_step_count = lv_step_count
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
  ls_intent-jobname = lv_jobname.
  ls_intent-jobcount = jobcount.
  ls_intent-owner = sy-uname.
  ls_intent-program = lv_program.
  ls_intent-step_count = lv_step_count.
  ls_intent-generation = lv_generation.
  ls_intent-created_on = sy-datum.
  ls_intent-created_at = sy-uzeit.
  lv_step_index = 1.
  WHILE lv_step_index <= lv_step_count.
    lv_step_no = lv_step_index.
    CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
      EXPORTING iv_command = 'READ' iv_jobname = jobname
                iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
                iv_intent_id = lv_intent iv_step_no = lv_step_no
      IMPORTING ev_program = lv_program ev_error = lv_error.
    IF lv_error IS NOT INITIAL OR lv_program IS INITIAL.
      DELETE FROM zosd_job_step WHERE mandt = sy-mandt AND intent_id = lv_intent.
      RAISE job_close_failed.
    ENDIF.
    CLEAR ls_step.
    ls_step-mandt = sy-mandt.
    ls_step-intent_id = lv_intent.
    ls_step-step_no = lv_step_index.
    ls_step-program = lv_program.
    INSERT zosd_job_step FROM ls_step.
    IF sy-subrc <> 0.
      DELETE FROM zosd_job_step WHERE mandt = sy-mandt AND intent_id = lv_intent.
      RAISE job_close_failed.
    ENDIF.
    lv_step_index = lv_step_index + 1.
  ENDWHILE.
  INSERT zosd_job_outbox FROM ls_intent.
  IF sy-subrc <> 0.
    DELETE FROM zosd_job_step WHERE mandt = sy-mandt AND intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'DONE' iv_jobname = jobname
              iv_jobcount = jobcount iv_owner = sy-uname iv_client = sy-mandt
              iv_intent_id = lv_intent
    IMPORTING ev_error = lv_error.
  IF lv_error IS NOT INITIAL.
    DELETE FROM zosd_job_outbox WHERE mandt = sy-mandt AND intent_id = lv_intent.
    DELETE FROM zosd_job_step WHERE mandt = sy-mandt AND intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
* No fallible port call follows this binding. Every handled earlier failure
* leaves the reservation unbound before the caller can COMMIT.
  UPDATE zosd_job_identity SET intent_id = lv_intent
    WHERE mandt = sy-mandt AND jobname = lv_jobname AND jobcount = jobcount
      AND owner = sy-uname AND intent_id = space.
  IF sy-subrc <> 0 OR sy-dbcnt <> 1.
    DELETE FROM zosd_job_outbox WHERE mandt = sy-mandt AND intent_id = lv_intent.
    DELETE FROM zosd_job_step WHERE mandt = sy-mandt AND intent_id = lv_intent.
    RAISE job_close_failed.
  ENDIF.
  job_was_released = 'X'.
ENDFUNCTION.
