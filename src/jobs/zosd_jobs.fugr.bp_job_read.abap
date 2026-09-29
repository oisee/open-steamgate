FUNCTION bp_job_read.
* TODO-measure: BP_JOB_READ numeric opcodes on A4H; constants are provisional.
  CONSTANTS lc_header TYPE i VALUE 1.
  CONSTANTS lc_with_steps TYPE i VALUE 2.
  DATA lv_state TYPE string.
  DATA lv_phase TYPE string.
  DATA lv_count TYPE string.
  DATA lv_program TYPE string.
  DATA lv_index TYPE i.
  DATA lv_index_text TYPE string.
  DATA ls_step TYPE tbtcstep.
  ret = 0.
  CLEAR: job_read_jobhead, joblog_attributes, epp_attributes,
         email_notification.
  IF job_read_opcode <> lc_header AND job_read_opcode <> lc_with_steps.
    RAISE invalid_opcode.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_READ'
    EXPORTING iv_jobname = job_read_jobname iv_jobcount = job_read_jobcount
    IMPORTING ev_phase = lv_phase ev_state = lv_state ev_step_count = lv_count
    EXCEPTIONS OTHERS = 1.
  IF sy-subrc <> 0.
    RAISE job_doesnt_exist.
  ENDIF.
  IF lv_count IS INITIAL OR lv_count = '0'.
    RAISE job_doesnt_have_steps.
  ENDIF.
  job_read_jobhead-jobname = job_read_jobname.
  job_read_jobhead-jobcount = job_read_jobcount.
  job_read_jobhead-sdluname = sy-uname.
  CASE lv_state.
    WHEN 'COMPLETED'.
      job_read_jobhead-status = 'F'.
    WHEN 'FAILED'.
      job_read_jobhead-status = 'A'.
    WHEN 'INTERRUPTED'.
      job_read_jobhead-status = 'A'.
    WHEN 'RUNNING'.
      job_read_jobhead-status = 'R'.
    WHEN 'QUEUED'.
      job_read_jobhead-status = 'Y'.
    WHEN 'WAITING'.
      job_read_jobhead-status = 'S'.
    WHEN OTHERS.
      job_read_jobhead-status = 'P'.
  ENDCASE.
  IF job_step_number IS NOT INITIAL AND job_step_number > lv_count.
    RAISE job_doesnt_have_steps.
  ENDIF.
  IF job_read_opcode = lc_header.
    RETURN.
  ENDIF.
  lv_index = 1.
  WHILE lv_index <= lv_count.
    IF job_step_number IS NOT INITIAL AND lv_index <> job_step_number.
      lv_index = lv_index + 1.
      CONTINUE.
    ENDIF.
    lv_index_text = lv_index.
    CALL FUNCTION 'ZOSD_JOB_READ'
      EXPORTING iv_jobname = job_read_jobname iv_jobcount = job_read_jobcount
                iv_item = 'STEP' iv_index = lv_index_text
      IMPORTING ev_step_program = lv_program
      EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      RAISE job_doesnt_have_steps.
    ENDIF.
    CLEAR ls_step.
    ls_step-jobname = job_read_jobname.
    ls_step-jobcount = job_read_jobcount.
    ls_step-stepcount = lv_index.
    ls_step-progname = lv_program.
    APPEND ls_step TO job_read_steplist.
    lv_index = lv_index + 1.
  ENDWHILE.
ENDFUNCTION.
