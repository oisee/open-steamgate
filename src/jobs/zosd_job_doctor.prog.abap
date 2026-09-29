REPORT zosd_job_doctor.

PARAMETERS p_name TYPE c LENGTH 32 OBLIGATORY.
PARAMETERS p_count TYPE c LENGTH 8 OBLIGATORY.
PARAMETERS p_warn TYPE c LENGTH 10 DEFAULT '3600'.
PARAMETERS p_log TYPE c LENGTH 4 DEFAULT '50'.

START-OF-SELECTION.
  DATA lt_lines TYPE zcl_osd_job_doctor=>ty_lines.
  DATA lv_line TYPE string.
  DATA lv_name TYPE string.
  DATA lv_count TYPE string.
  DATA lv_warn TYPE string.
  DATA lv_log TYPE string.
  lv_name = p_name.
  lv_count = p_count.
  lv_warn = p_warn.
  lv_log = p_log.
  lt_lines = zcl_osd_job_doctor=>inspect(
    iv_jobname = lv_name iv_jobcount = lv_count
    iv_warn_seconds = lv_warn iv_log_limit = lv_log ).
  lt_lines = zcl_osd_job_doctor=>for_list( lt_lines ).
  LOOP AT lt_lines INTO lv_line.
    WRITE / lv_line.
  ENDLOOP.
