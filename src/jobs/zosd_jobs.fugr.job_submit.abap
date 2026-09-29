FUNCTION job_submit.
*" IMPORTING JOBNAME JOBCOUNT REPORT VARIANT AUTHCKNAM COMMANDNAME EXTPGM_NAME
*" EXCEPTIONS JOBNAME_MISSING JOB_NOTEX PROGRAM_MISSING JOB_SUBMIT_FAILED
  DATA lv_error TYPE string.
  DATA lv_program TYPE string.
  DATA lv_step_count TYPE string.
  DATA lv_auth_user TYPE string.
  lv_auth_user = sy-uname.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  IF report IS NOT INITIAL AND ( commandname IS NOT INITIAL OR extpgm_name IS NOT INITIAL ).
    RAISE prog_abap_and_extpg_set.
  ENDIF.
  IF priparams IS NOT INITIAL.
    RAISE bad_priparams.
  ENDIF.
  IF commandname IS NOT INITIAL OR extpgm_name IS NOT INITIAL
      OR operatingsystem IS NOT INITIAL OR extpgm_param IS NOT INITIAL
      OR extpgm_set_trace_on IS NOT INITIAL OR extpgm_system IS NOT INITIAL
      OR extpgm_rfcdest IS NOT INITIAL
      OR ( extpgm_stderr_in_joblog IS NOT INITIAL AND extpgm_stderr_in_joblog <> 'X' )
      OR ( extpgm_stdout_in_joblog IS NOT INITIAL AND extpgm_stdout_in_joblog <> 'X' )
      OR ( extpgm_wait_for_termination IS NOT INITIAL AND extpgm_wait_for_termination <> 'X' ).
    RAISE bad_xpgflags.
  ENDIF.
  IF report IS INITIAL
      OR variant IS NOT INITIAL OR authcknam <> lv_auth_user
      OR arcparams IS NOT INITIAL OR ( language IS NOT INITIAL AND language <> sy-langu ).
    RAISE job_submit_failed.
  ENDIF.
  lv_program = report.
  TRANSLATE lv_program TO UPPER CASE.
  IF zcl_osd_batch_report=>supports( lv_program ) <> abap_true.
    RAISE program_missing.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'SUBMIT' iv_jobname = jobname
              iv_jobcount = jobcount iv_program = lv_program
              iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_error = lv_error ev_step_count = lv_step_count.
  IF lv_error = 'Job definition not found in this LUW'.
    RAISE job_notex.
  ENDIF.
  IF lv_error IS NOT INITIAL.
    RAISE job_submit_failed.
  ENDIF.
  step_number = lv_step_count.
ENDFUNCTION.
