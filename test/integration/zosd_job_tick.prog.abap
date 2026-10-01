REPORT zosd_job_tick.

* A periodic-job probe: one row per instance, keyed by the time ABAP saw.
START-OF-SELECTION.
  DATA ls_seen TYPE zosd_job_seen.
  DATA lv_stamp TYPE string.
  GET TIME.
  lv_stamp = sy-datum.
  lv_stamp = lv_stamp && sy-uzeit.
  ls_seen-run_id = 'PERIODIC_TICK'.
  ls_seen-row_no = sy-uzeit.
  ls_seen-kind = 'T'.
  ls_seen-param = lv_stamp.
  INSERT zosd_job_seen FROM ls_seen.
  WRITE lv_stamp.
