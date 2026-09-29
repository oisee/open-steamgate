CLASS zcl_osd_job_doctor DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_lines TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    CLASS-METHODS assess
      IMPORTING iv_phase TYPE string iv_state TYPE string
                iv_since TYPE string iv_now TYPE timestamp
                iv_warn_seconds TYPE i
      RETURNING VALUE(rv_assessment) TYPE string.
    CLASS-METHODS inspect
      IMPORTING iv_jobname TYPE string iv_jobcount TYPE string
                iv_warn_seconds TYPE string DEFAULT '3600'
                iv_log_limit TYPE string DEFAULT '50'
      RETURNING VALUE(rt_lines) TYPE ty_lines.
    CLASS-METHODS for_list
      IMPORTING it_lines TYPE ty_lines
      RETURNING VALUE(rt_lines) TYPE ty_lines.
  PRIVATE SECTION.
    CLASS-METHODS error_name
      IMPORTING iv_subrc TYPE sy-subrc
      RETURNING VALUE(rv_name) TYPE string.
ENDCLASS.

CLASS zcl_osd_job_doctor IMPLEMENTATION.
  METHOD error_name.
    CASE iv_subrc.
      WHEN 1.
        rv_name = 'NOT_FOUND'.
      WHEN 2.
        rv_name = 'FORBIDDEN'.
      WHEN 3.
        rv_name = 'INCONSISTENT'.
      WHEN 4.
        rv_name = 'LEGACY'.
      WHEN 5.
        rv_name = 'UNCOMMITTED'.
      WHEN 6.
        rv_name = 'TOO_LARGE'.
      WHEN 7.
        rv_name = 'UNAVAILABLE'.
      WHEN 8.
        rv_name = 'BAD_KEY'.
      WHEN OTHERS.
        rv_name = 'UNKNOWN'.
    ENDCASE.
  ENDMETHOD.

  METHOD for_list.
    DATA lv_line TYPE string.
    DATA lv_offset TYPE i.
    DATA lv_chunk TYPE i.
    LOOP AT it_lines INTO lv_line.
      lv_offset = 0.
      DO.
        IF lv_offset >= strlen( lv_line ).
          EXIT.
        ENDIF.
        lv_chunk = strlen( lv_line ) - lv_offset.
        IF lv_chunk > 70.
          lv_chunk = 70.
        ENDIF.
        APPEND lv_line+lv_offset(lv_chunk) TO rt_lines.
        lv_offset = lv_offset + lv_chunk.
      ENDDO.
    ENDLOOP.
  ENDMETHOD.

  METHOD assess.
    DATA lv_stamp TYPE timestamp.
    DATA lv_age TYPE i.
    DATA lv_stamp_text TYPE string.
    DATA lv_year TYPE i.
    DATA lv_month TYPE i.
    DATA lv_day TYPE i.
    DATA lv_days TYPE i.
    DATA lv_hour TYPE i.
    DATA lv_minute TYPE i.
    DATA lv_second TYPE i.
    CASE iv_phase.
      WHEN 'RESERVED'.
        rv_assessment = 'INFO: reserved; scheduling is not complete'.
        RETURN.
      WHEN 'OUTBOX'.
        rv_assessment = 'INFO: committed intent awaits import'.
        RETURN.
    ENDCASE.
    CASE iv_state.
      WHEN 'WAITING'.
        rv_assessment = 'INFO: configured wait is expected; age alone does not imply a stall'.
      WHEN 'COMPLETED'.
        rv_assessment = 'HEALTHY: completed'.
      WHEN 'FAILED' OR 'INTERRUPTED'.
        rv_assessment = 'REVIEW: failed or interrupted; no automatic replay'.
      WHEN 'QUEUED' OR 'RUNNING'.
        rv_assessment = 'INFO: active; no heartbeat is available'.
        IF iv_warn_seconds <= 0.
          RETURN.
        ENDIF.
        IF strlen( iv_since ) = 20.
          IF iv_since+19(1) <> 'Z'.
            RETURN.
          ENDIF.
        ELSEIF strlen( iv_since ) = 24.
          IF iv_since+19(1) <> '.' OR iv_since+23(1) <> 'Z'
             OR iv_since+20(3) CN '0123456789'.
            RETURN.
          ENDIF.
        ELSE.
          RETURN.
        ENDIF.
        IF iv_since+4(1) <> '-' OR iv_since+7(1) <> '-'
           OR iv_since+10(1) <> 'T' OR iv_since+13(1) <> ':'
           OR iv_since+16(1) <> ':'.
          RETURN.
        ENDIF.
        CONCATENATE iv_since+0(4) iv_since+5(2) iv_since+8(2)
                    iv_since+11(2) iv_since+14(2) iv_since+17(2)
          INTO lv_stamp_text.
        IF lv_stamp_text CN '0123456789'.
          RETURN.
        ENDIF.
        lv_year = iv_since+0(4).
        lv_month = iv_since+5(2).
        lv_day = iv_since+8(2).
        lv_hour = iv_since+11(2).
        lv_minute = iv_since+14(2).
        lv_second = iv_since+17(2).
        IF lv_year < 1 OR lv_month < 1 OR lv_month > 12
           OR lv_hour > 23 OR lv_minute > 59 OR lv_second > 59.
          RETURN.
        ENDIF.
        CASE lv_month.
          WHEN 4 OR 6 OR 9 OR 11.
            lv_days = 30.
          WHEN 2.
            lv_days = 28.
            IF lv_year MOD 400 = 0 OR
               ( lv_year MOD 4 = 0 AND lv_year MOD 100 <> 0 ).
              lv_days = 29.
            ENDIF.
          WHEN OTHERS.
            lv_days = 31.
        ENDCASE.
        IF lv_day < 1 OR lv_day > lv_days.
          RETURN.
        ENDIF.
        lv_stamp = lv_stamp_text.
        lv_age = cl_abap_tstmp=>subtract( tstmp1 = iv_now tstmp2 = lv_stamp ).
        IF lv_age >= iv_warn_seconds.
          rv_assessment = 'WARN: age exceeds threshold; no heartbeat, so stalled is unproven'.
        ENDIF.
      WHEN OTHERS.
        rv_assessment = 'INFO: state requires inspection'.
    ENDCASE.
  ENDMETHOD.

  METHOD inspect.
    DATA lv_phase TYPE string.
    DATA lv_state TYPE string.
    DATA lv_result TYPE string.
    DATA lv_steps TYPE string.
    DATA lv_logs TYPE string.
    DATA lv_gap TYPE string.
    DATA lv_created_on TYPE string.
    DATA lv_created_at TYPE string.
    DATA lv_queued TYPE string.
    DATA lv_started TYPE string.
    DATA lv_ended TYPE string.
    DATA lv_wait_kind TYPE string.
    DATA lv_wait_name TYPE string.
    DATA lv_wait_count TYPE string.
    DATA lv_wait_event TYPE string.
    DATA lv_number TYPE string.
    DATA lv_program TYPE string.
    DATA lv_step_state TYPE string.
    DATA lv_step_start TYPE string.
    DATA lv_step_end TYPE string.
    DATA lv_step_result TYPE string.
    DATA lv_sequence TYPE string.
    DATA lv_log_step TYPE string.
    DATA lv_log_at TYPE string.
    DATA lv_event TYPE string.
    DATA lv_severity TYPE string.
    DATA lv_text TYPE string.
    DATA lv_index TYPE string.
    DATA lv_count TYPE i.
    DATA lv_total TYPE i.
    DATA lv_limit TYPE i.
    DATA lv_first TYPE i.
    DATA lv_warn_seconds TYPE i.
    DATA lv_final_phase TYPE string.
    DATA lv_final_state TYPE string.
    DATA lv_final_steps TYPE string.
    DATA lv_final_logs TYPE string.
    DATA lv_now TYPE timestamp.
    DATA lv_since TYPE string.

    IF iv_jobname IS INITIAL OR iv_jobcount IS INITIAL.
      APPEND 'ERROR: exact JOBNAME and JOBCOUNT are required' TO rt_lines.
      RETURN.
    ENDIF.
    CALL FUNCTION 'ZOSD_JOB_READ'
      EXPORTING iv_jobname = iv_jobname iv_jobcount = iv_jobcount
                iv_item = 'HEADER'
      IMPORTING ev_phase = lv_phase ev_state = lv_state
                ev_result_status = lv_result ev_step_count = lv_steps
                ev_log_count = lv_logs ev_historical_gap = lv_gap
                ev_created_on = lv_created_on ev_created_at = lv_created_at
                ev_queued_at = lv_queued ev_started_at = lv_started
                ev_ended_at = lv_ended ev_wait_kind = lv_wait_kind
                ev_wait_jobname = lv_wait_name ev_wait_jobcount = lv_wait_count
                ev_wait_event_id = lv_wait_event
      EXCEPTIONS not_found = 1 forbidden = 2 inconsistent = 3
                 legacy = 4 uncommitted = 5 too_large = 6
                 unavailable = 7 bad_key = 8 OTHERS = 9.
    IF sy-subrc <> 0.
      APPEND |ERROR: ZOSD_JOB_READ HEADER { error_name( sy-subrc ) }| TO rt_lines.
      RETURN.
    ENDIF.
    APPEND |Job { iv_jobname }/{ iv_jobcount }: { lv_phase } { lv_state } result={ lv_result }| TO rt_lines.
    IF lv_created_on IS NOT INITIAL.
      APPEND |Created: { lv_created_on } { lv_created_at }| TO rt_lines.
    ENDIF.
    APPEND |Queued: { lv_queued } Started: { lv_started } Ended: { lv_ended }| TO rt_lines.
    IF lv_wait_kind = 'AFTER_JOB'.
      APPEND |Wait: predecessor { lv_wait_name }/{ lv_wait_count }| TO rt_lines.
    ELSEIF lv_wait_kind = 'NAMED_EVENT'.
      APPEND |Wait: event { lv_wait_event }| TO rt_lines.
    ELSEIF lv_wait_kind IS NOT INITIAL.
      APPEND |Wait: { lv_wait_kind }| TO rt_lines.
    ENDIF.
    IF lv_gap IS NOT INITIAL.
      APPEND |Historical gap: { lv_gap }; technical history may be incomplete| TO rt_lines.
    ENDIF.
    lv_since = lv_queued.
    IF lv_state = 'RUNNING'.
      lv_since = lv_started.
    ENDIF.
    GET TIME STAMP FIELD lv_now.
    IF iv_warn_seconds IS INITIAL OR iv_warn_seconds CN '0123456789'
       OR strlen( iv_warn_seconds ) > 8.
      APPEND 'ERROR: warning age must be a nonnegative number of seconds' TO rt_lines.
      RETURN.
    ENDIF.
    lv_warn_seconds = iv_warn_seconds.
    APPEND assess( iv_phase = lv_phase iv_state = lv_state iv_since = lv_since
                   iv_now = lv_now iv_warn_seconds = lv_warn_seconds ) TO rt_lines.

    IF lv_steps IS INITIAL OR lv_steps CN '0123456789'.
      APPEND 'ERROR: invalid step count in snapshot' TO rt_lines.
      RETURN.
    ENDIF.
    lv_count = lv_steps.
    IF lv_count > 16 OR lv_count < 0.
      APPEND 'ERROR: invalid step count in snapshot' TO rt_lines.
      RETURN.
    ENDIF.
    DO lv_count TIMES.
      lv_index = sy-index.
      CALL FUNCTION 'ZOSD_JOB_READ'
        EXPORTING iv_jobname = iv_jobname iv_jobcount = iv_jobcount
                  iv_item = 'STEP' iv_index = lv_index
        IMPORTING ev_step_number = lv_number ev_step_program = lv_program
                  ev_step_state = lv_step_state ev_step_started_at = lv_step_start
                  ev_step_ended_at = lv_step_end
                  ev_step_result_status = lv_step_result
        EXCEPTIONS not_found = 1 forbidden = 2 inconsistent = 3
                   legacy = 4 uncommitted = 5 too_large = 6
                   unavailable = 7 bad_key = 8 OTHERS = 9.
      IF sy-subrc <> 0.
        APPEND |ERROR: ZOSD_JOB_READ STEP { lv_index } { error_name( sy-subrc ) }| TO rt_lines.
        RETURN.
      ENDIF.
      APPEND |Step { lv_number }: { lv_program } { lv_step_state } result={ lv_step_result } start={ lv_step_start } end={ lv_step_end }| TO rt_lines.
    ENDDO.
    IF lv_logs IS INITIAL OR lv_logs CN '0123456789'.
      APPEND 'ERROR: invalid log count in snapshot' TO rt_lines.
      RETURN.
    ENDIF.
    lv_total = lv_logs.
    IF lv_total > 2000 OR lv_total < 0.
      APPEND 'ERROR: invalid log count in snapshot' TO rt_lines.
      RETURN.
    ENDIF.
    IF iv_log_limit IS INITIAL OR iv_log_limit CN '0123456789'
       OR strlen( iv_log_limit ) > 4.
      APPEND 'ERROR: log limit must be a nonnegative number' TO rt_lines.
      RETURN.
    ENDIF.
    lv_limit = iv_log_limit.
    IF lv_limit < 0.
      lv_limit = 0.
    ELSEIF lv_limit > 200.
      lv_limit = 200.
    ENDIF.
    lv_count = lv_total.
    IF lv_count > lv_limit.
      lv_count = lv_limit.
    ENDIF.
    lv_first = lv_total - lv_count + 1.
    APPEND |Technical log ({ lv_count } of { lv_total } entries; latest entries):| TO rt_lines.
    DO lv_count TIMES.
      lv_index = lv_first + sy-index - 1.
      CALL FUNCTION 'ZOSD_JOB_READ'
        EXPORTING iv_jobname = iv_jobname iv_jobcount = iv_jobcount
                  iv_item = 'LOG' iv_index = lv_index
        IMPORTING ev_log_sequence = lv_sequence ev_log_step = lv_log_step
                  ev_log_at = lv_log_at ev_log_event = lv_event
                  ev_log_severity = lv_severity ev_log_text = lv_text
        EXCEPTIONS not_found = 1 forbidden = 2 inconsistent = 3
                   legacy = 4 uncommitted = 5 too_large = 6
                   unavailable = 7 bad_key = 8 OTHERS = 9.
      IF sy-subrc <> 0.
        APPEND |ERROR: ZOSD_JOB_READ LOG { lv_index } { error_name( sy-subrc ) }| TO rt_lines.
        RETURN.
      ENDIF.
      APPEND |{ lv_sequence } { lv_log_at } step={ lv_log_step } { lv_severity } { lv_event }: { lv_text }| TO rt_lines.
    ENDDO.
    IF lv_total > lv_count.
      APPEND |{ lv_total - lv_count } earlier log entries omitted; increase P_LOG up to 200| TO rt_lines.
    ENDIF.
    CALL FUNCTION 'ZOSD_JOB_READ'
      EXPORTING iv_jobname = iv_jobname iv_jobcount = iv_jobcount
                iv_item = 'HEADER'
      IMPORTING ev_phase = lv_final_phase ev_state = lv_final_state
                ev_step_count = lv_final_steps ev_log_count = lv_final_logs
      EXCEPTIONS not_found = 1 forbidden = 2 inconsistent = 3
                 legacy = 4 uncommitted = 5 too_large = 6
                 unavailable = 7 bad_key = 8 OTHERS = 9.
    IF sy-subrc <> 0.
      APPEND |WARNING: final HEADER { error_name( sy-subrc ) }; view may have changed| TO rt_lines.
    ELSEIF lv_final_phase <> lv_phase OR lv_final_state <> lv_state
       OR lv_final_steps <> lv_steps OR lv_final_logs <> lv_logs.
      APPEND 'WARNING: job changed during read; rerun for a fresh view' TO rt_lines.
    ENDIF.
    APPEND 'Each read is a separate snapshot; this report is not atomic.' TO rt_lines.
  ENDMETHOD.
ENDCLASS.
