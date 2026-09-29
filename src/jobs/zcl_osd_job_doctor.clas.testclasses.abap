CLASS ltcl_job_doctor DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS phases FOR TESTING.
    METHODS age_warning FOR TESTING.
    METHODS missing_key FOR TESTING.
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
ENDCLASS.
