REPORT zosd_job_dump.

* A periodic-job probe: writes one row, then dumps. The dialog step that
* runs it must roll the row back (test/job-periodic.mjs).
START-OF-SELECTION.
  DATA ls_seen TYPE zosd_job_seen.
  DATA lv_zero TYPE i.
  DATA lv_result TYPE i.
  ls_seen-run_id = 'PERIODIC_DUMP'.
  ls_seen-row_no = 0.
  ls_seen-kind = 'D'.
  INSERT zosd_job_seen FROM ls_seen.
  lv_result = 1 / lv_zero.
  WRITE lv_result.
