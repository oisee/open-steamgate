REPORT zosd_job_doctor LINE-SIZE 255.

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
  DATA lv_offset TYPE i.
  DATA lv_chunk TYPE i.
  lv_name = p_name.
  lv_count = p_count.
  lv_warn = p_warn.
  lv_log = p_log.
  lt_lines = zcl_osd_job_doctor=>inspect(
    iv_jobname = lv_name iv_jobcount = lv_count
    iv_warn_seconds = lv_warn iv_log_limit = lv_log ).
  LOOP AT lt_lines INTO lv_line.
    lv_offset = 0.
    WHILE lv_offset < strlen( lv_line ).
      lv_chunk = strlen( lv_line ) - lv_offset.
      IF lv_chunk > 240.
        lv_chunk = 240.
      ENDIF.
      WRITE / lv_line+lv_offset(lv_chunk).
      lv_offset = lv_offset + lv_chunk.
    ENDWHILE.
  ENDLOOP.
