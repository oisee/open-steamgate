FUNCTION bp_job_select.
  DATA ls_identity TYPE zosd_job_identity.
  DATA ls_job TYPE tbtcjob.
  DATA lv_state TYPE string.
  DATA lv_phase TYPE string.
  DATA lv_status TYPE c LENGTH 1.
  DATA lv_selected TYPE c LENGTH 1.
  DATA ls_name_range TYPE njrange.
  DATA ls_user_range TYPE unrange.
  DATA lv_name_include TYPE abap_bool.
  DATA lv_name_match TYPE abap_bool.
  DATA lv_name_exclude TYPE abap_bool.
  DATA lv_user_include TYPE abap_bool.
  DATA lv_user_match TYPE abap_bool.
  DATA lv_user_exclude TYPE abap_bool.
  DATA lv_row_match TYPE abap_bool.
  ret = 0.
  CLEAR: jobsel_param_out, local_client, nr_of_jobs_found.
  IF jobselect_dialog <> 'N'.
    RAISE invalid_dialog_type.
  ENDIF.
  IF enddate IS NOT INITIAL OR endtime IS NOT INITIAL
      OR adk_mode IS NOT INITIAL OR ( selection IS NOT INITIAL AND selection <> 'AL' )
      OR ( only_this_subsystem IS NOT INITIAL AND only_this_subsystem <> 'Y' ).
    RAISE selection_canceled.
  ENDIF.
  jobsel_param_out = jobsel_param_in.
  local_client = 'X'.
  SELECT * FROM zosd_job_identity INTO ls_identity
    WHERE mandt = sy-mandt AND owner = sy-uname.
    IF jobsel_param_in-jobname IS NOT INITIAL
        AND ls_identity-jobname <> jobsel_param_in-jobname.
      CONTINUE.
    ENDIF.
    IF jobsel_param_in-username IS NOT INITIAL
        AND ls_identity-owner <> jobsel_param_in-username.
      CONTINUE.
    ENDIF.
    IF jobname_ext_sel IS SUPPLIED AND jobname_ext_sel IS NOT INITIAL.
      CLEAR: lv_name_include, lv_name_match, lv_name_exclude.
      LOOP AT jobname_ext_sel INTO ls_name_range.
        IF ( ls_name_range-sign <> 'I' AND ls_name_range-sign <> 'E' )
            OR ( ls_name_range-option <> 'EQ' AND ls_name_range-option <> 'CP'
              AND ls_name_range-option <> 'BT' ) OR ls_name_range-low IS INITIAL
            OR ( ls_name_range-option = 'BT' AND ls_name_range-high IS INITIAL ).
          RAISE jobname_missing.
        ENDIF.
        IF ls_name_range-sign = 'I'.
          lv_name_include = abap_true.
        ENDIF.
        lv_row_match = abap_false.
        CASE ls_name_range-option.
          WHEN 'EQ'.
            IF ls_identity-jobname = ls_name_range-low.
              lv_row_match = abap_true.
            ENDIF.
          WHEN 'CP'.
            IF ls_identity-jobname CP ls_name_range-low.
              lv_row_match = abap_true.
            ENDIF.
          WHEN 'BT'.
            IF ls_identity-jobname >= ls_name_range-low
                AND ls_identity-jobname <= ls_name_range-high.
              lv_row_match = abap_true.
            ENDIF.
        ENDCASE.
        IF lv_row_match = abap_true.
          IF ls_name_range-sign = 'E'.
            lv_name_exclude = abap_true.
          ELSE.
            lv_name_match = abap_true.
          ENDIF.
        ENDIF.
      ENDLOOP.
      IF lv_name_exclude = abap_true OR
          ( lv_name_include = abap_true AND lv_name_match = abap_false ).
        CONTINUE.
      ENDIF.
    ENDIF.
    IF username_ext_sel IS SUPPLIED AND username_ext_sel IS NOT INITIAL.
      CLEAR: lv_user_include, lv_user_match, lv_user_exclude.
      LOOP AT username_ext_sel INTO ls_user_range.
        IF ( ls_user_range-sign <> 'I' AND ls_user_range-sign <> 'E' )
            OR ( ls_user_range-option <> 'EQ' AND ls_user_range-option <> 'CP'
              AND ls_user_range-option <> 'BT' ) OR ls_user_range-low IS INITIAL
            OR ( ls_user_range-option = 'BT' AND ls_user_range-high IS INITIAL ).
          RAISE username_missing.
        ENDIF.
        IF ls_user_range-sign = 'I'.
          lv_user_include = abap_true.
        ENDIF.
        lv_row_match = abap_false.
        CASE ls_user_range-option.
          WHEN 'EQ'.
            IF ls_identity-owner = ls_user_range-low.
              lv_row_match = abap_true.
            ENDIF.
          WHEN 'CP'.
            IF ls_identity-owner CP ls_user_range-low.
              lv_row_match = abap_true.
            ENDIF.
          WHEN 'BT'.
            IF ls_identity-owner >= ls_user_range-low
                AND ls_identity-owner <= ls_user_range-high.
              lv_row_match = abap_true.
            ENDIF.
        ENDCASE.
        IF lv_row_match = abap_true.
          IF ls_user_range-sign = 'E'.
            lv_user_exclude = abap_true.
          ELSE.
            lv_user_match = abap_true.
          ENDIF.
        ENDIF.
      ENDLOOP.
      IF lv_user_exclude = abap_true OR
          ( lv_user_include = abap_true AND lv_user_match = abap_false ).
        CONTINUE.
      ENDIF.
    ENDIF.
    CALL FUNCTION 'ZOSD_JOB_STATUS'
      EXPORTING iv_jobname = ls_identity-jobname iv_jobcount = ls_identity-jobcount
      IMPORTING ev_phase = lv_phase ev_state = lv_state
      EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.
    CASE lv_state.
      WHEN 'COMPLETED'.
        lv_status = 'F'.
      WHEN 'FAILED'.
        lv_status = 'A'.
      WHEN 'INTERRUPTED'.
        lv_status = 'A'.
      WHEN 'RUNNING'.
        lv_status = 'R'.
      WHEN 'READY'.
        lv_status = 'Y'.
      WHEN 'QUEUED'.
        lv_status = 'Y'.
      WHEN 'WAITING'.
        lv_status = 'S'.
      WHEN OTHERS.
        lv_status = 'P'.
    ENDCASE.
    lv_selected = space.
    IF jobsel_param_in-preliminary IS NOT INITIAL OR jobsel_param_in-scheduled IS NOT INITIAL
        OR jobsel_param_in-ready IS NOT INITIAL OR jobsel_param_in-running IS NOT INITIAL
        OR jobsel_param_in-finished IS NOT INITIAL OR jobsel_param_in-aborted IS NOT INITIAL.
      CASE lv_status.
        WHEN 'P'.
          lv_selected = jobsel_param_in-preliminary.
        WHEN 'S'.
          lv_selected = jobsel_param_in-scheduled.
        WHEN 'Y'.
          lv_selected = jobsel_param_in-ready.
        WHEN 'R'.
          lv_selected = jobsel_param_in-running.
        WHEN 'F'.
          lv_selected = jobsel_param_in-finished.
        WHEN 'A'.
          lv_selected = jobsel_param_in-aborted.
      ENDCASE.
      IF lv_selected IS INITIAL.
        CONTINUE.
      ENDIF.
    ENDIF.
    CLEAR ls_job.
    ls_job-jobname = ls_identity-jobname.
    ls_job-jobcount = ls_identity-jobcount.
    ls_job-sdluname = ls_identity-owner.
    ls_job-status = lv_status.
    APPEND ls_job TO jobselect_joblist.
    nr_of_jobs_found = nr_of_jobs_found + 1.
  ENDSELECT.
  IF nr_of_jobs_found = 0.
    RAISE no_jobs_found.
  ENDIF.
ENDFUNCTION.
