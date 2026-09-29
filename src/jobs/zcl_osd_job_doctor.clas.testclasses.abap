CLASS ltcl_job_doctor DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS phases FOR TESTING.
    METHODS age_warning FOR TESTING.
    METHODS missing_key FOR TESTING.
    METHODS standard_facade_guards FOR TESTING.
ENDCLASS.

CLASS ltcl_job_doctor IMPLEMENTATION.
  METHOD phases.
    DATA lv_now TYPE timestamp.
    lv_now = '20260929130000'.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OUTBOX' iv_state = 'WAITING'
        iv_since = '' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'INFO: committed intent awaits import' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OPERATIONS' iv_state = 'WAITING'
        iv_since = '2026-09-29T00:00:00Z' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'INFO: configured wait is expected; age alone does not imply a stall' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OPERATIONS' iv_state = 'FAILED'
        iv_since = '' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'REVIEW: failed or interrupted; no automatic replay' ).
  ENDMETHOD.

  METHOD age_warning.
    DATA lv_now TYPE timestamp.
    lv_now = '20260929130000'.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OPERATIONS' iv_state = 'QUEUED'
        iv_since = '2026-09-29T11:00:00.000Z' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'WARN: age exceeds threshold; no heartbeat, so stalled is unproven' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OPERATIONS' iv_state = 'RUNNING'
        iv_since = '' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'INFO: active; no heartbeat is available' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_job_doctor=>assess( iv_phase = 'OPERATIONS' iv_state = 'RUNNING'
        iv_since = '2026-02-30T00:00:00Z' iv_now = lv_now iv_warn_seconds = 3600 )
      exp = 'INFO: active; no heartbeat is available' ).
  ENDMETHOD.

  METHOD missing_key.
    DATA lt_lines TYPE zcl_osd_job_doctor=>ty_lines.
    DATA lv_line TYPE string.
    lt_lines = zcl_osd_job_doctor=>inspect( iv_jobname = '' iv_jobcount = '' ).
    READ TABLE lt_lines INDEX 1 INTO lv_line.
    cl_abap_unit_assert=>assert_equals(
      act = lv_line exp = 'ERROR: exact JOBNAME and JOBCOUNT are required' ).
  ENDMETHOD.

  METHOD standard_facade_guards.
    DATA lv_name TYPE c LENGTH 32.
    DATA lv_count TYPE c LENGTH 8.
    DATA lv_flag TYPE c LENGTH 1.
    DATA lv_header TYPE tbtcjob.
    lv_name = 'UNIT_JOB'.
    lv_count = '00000001'.
    lv_flag = 'X'.
    CALL FUNCTION 'JOB_OPEN'
      EXPORTING jobname = space
      IMPORTING jobcount = lv_count
      EXCEPTIONS jobname_missing = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_OPEN'
      EXPORTING jobname = lv_name jobgroup = lv_flag
      EXCEPTIONS invalid_job_data = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING jobname = space jobcount = lv_count authcknam = sy-uname
      EXCEPTIONS jobname_missing = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING jobname = lv_name jobcount = lv_count authcknam = sy-uname
                extpgm_name = 'external'
      EXCEPTIONS bad_xpgflags = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING jobname = lv_name jobcount = lv_count authcknam = sy-uname
                report = 'ZGG_EX_012' priparams = 'printer'
      EXCEPTIONS bad_priparams = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING jobname = lv_name jobcount = lv_count authcknam = sy-uname
                report = 'ZGG_EX_012' extpgm_name = 'external'
      EXCEPTIONS prog_abap_and_extpg_set = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname = space jobcount = lv_count
      EXCEPTIONS jobname_missing = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname = lv_name jobcount = lv_count sdlstrtdt = '20261001'
      EXCEPTIONS invalid_startdate = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname = lv_name jobcount = lv_count targetserver = 'OTHER'
      EXCEPTIONS invalid_target = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname = lv_name jobcount = lv_count time_zone = 'UTC'
      EXCEPTIONS invalid_time_zone = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_EVENT_RAISE'
      EXPORTING eventid = space
      EXCEPTIONS eventid_missing = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_EVENT_RAISE'
      EXPORTING eventid = 'THIS_EVENT_NAME_IS_TOO_LONG_TO_BE_VALID_123'
      EXCEPTIONS bad_eventid = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_EVENT_RAISE'
      EXPORTING eventid = 'UNIT_EVENT' target_instance = 'OTHER'
      EXCEPTIONS raise_failed = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'SHOW_JOBSTATE'
      EXPORTING jobname = lv_name jobcount = space
      IMPORTING finished = lv_flag
      EXCEPTIONS jobcount_missing = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_JOB_READ'
      EXPORTING job_read_jobname = lv_name job_read_jobcount = lv_count
                job_read_opcode = 999
      IMPORTING job_read_jobhead = lv_header
      EXCEPTIONS invalid_opcode = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_JOB_SELECT'
      EXPORTING jobselect_dialog = 'Y'
      EXCEPTIONS invalid_dialog_type = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
    CALL FUNCTION 'BP_JOB_SELECT'
      EXPORTING jobselect_dialog = 'N' selection = 'XX'
      EXCEPTIONS selection_canceled = 1 OTHERS = 2.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 1 ).
  ENDMETHOD.
ENDCLASS.
