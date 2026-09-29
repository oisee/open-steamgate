FUNCTION show_jobstate.
  DATA lv_phase TYPE string.
  DATA lv_state TYPE string.
  CLEAR: aborted, finished, preliminary, ready, running, scheduled, suspended, other.
  IF jobname IS INITIAL.
    RAISE jobname_missing.
  ENDIF.
  IF jobcount IS INITIAL.
    RAISE jobcount_missing.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_STATUS'
    EXPORTING iv_jobname = jobname iv_jobcount = jobcount
    IMPORTING ev_phase = lv_phase ev_state = lv_state
    EXCEPTIONS OTHERS = 1.
  IF sy-subrc <> 0.
    RAISE job_notex.
  ENDIF.
  CASE lv_state.
    WHEN 'COMPLETED'.
      finished = 'X'.
    WHEN 'FAILED'.
      aborted = 'X'.
    WHEN 'INTERRUPTED'.
      aborted = 'X'.
    WHEN 'RUNNING'.
      running = 'X'.
    WHEN 'QUEUED'.
      ready = 'X'.
    WHEN 'WAITING'.
      scheduled = 'X'.
    WHEN OTHERS.
      IF lv_phase = 'RESERVED'.
        preliminary = 'X'.
      ELSEIF lv_phase = 'OUTBOX'.
        ready = 'X'.
      ELSE.
        other = 'X'.
      ENDIF.
  ENDCASE.
ENDFUNCTION.
