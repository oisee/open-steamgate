REPORT zosd_job_e2e.

DATA gv_text TYPE string.
SELECT-OPTIONS s_text FOR gv_text.
PARAMETERS p_run TYPE c LENGTH 32.

START-OF-SELECTION.
  DATA ls_seen TYPE zosd_job_seen.
  DATA lv_row TYPE i.
  ls_seen-run_id = p_run.
  ls_seen-row_no = 0.
  ls_seen-kind = 'P'.
  ls_seen-param = p_run.
  INSERT zosd_job_seen FROM ls_seen.
  LOOP AT s_text INTO DATA(ls_range).
    lv_row = lv_row + 1.
    CLEAR ls_seen.
    ls_seen-run_id = p_run.
    ls_seen-row_no = lv_row.
    ls_seen-kind = 'R'.
    ls_seen-sign = ls_range-sign.
    ls_seen-option = ls_range-option.
    ls_seen-low = /ui2/cl_json=>serialize( data = ls_range-low ).
    ls_seen-high = /ui2/cl_json=>serialize( data = ls_range-high ).
    INSERT zosd_job_seen FROM ls_seen.
  ENDLOOP.
  WRITE lv_row.
  IF p_run = 'SEL_I_EQ' OR p_run = 'SEL_E_EQ' OR p_run = 'SEL_I_CP'.
    DATA lv_hits TYPE i.
    IF 'ALPHA' IN s_text.
      lv_hits = lv_hits + 1.
    ENDIF.
    IF 'BETA' IN s_text.
      lv_hits = lv_hits + 1.
    ENDIF.
    IF 'GAMMA' IN s_text.
      lv_hits = lv_hits + 1.
    ENDIF.
    CLEAR ls_seen.
    ls_seen-run_id = p_run.
    ls_seen-row_no = 99.
    ls_seen-kind = 'H'.
    ls_seen-param = lv_hits.
    INSERT zosd_job_seen FROM ls_seen.
  ENDIF.
