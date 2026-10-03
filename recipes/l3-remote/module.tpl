FUNCTION {{function_lower}}.
* Flat DDIC only. The classic refusal is committed so its audit survives.
  DATA ls_expected TYPE zosd_l3_snap.
  ls_expected-snap_id = is_header-snap_id.
  ls_expected-content_hash = is_header-content_hash.
  ls_expected-row_count = is_header-row_count.
  IF {{runner}}=>check_snapshot( is_expected = ls_expected iv_run = is_header-run_id ) = abap_false.
    COMMIT WORK.
    RAISE snapshot_mismatch.
  ENDIF.
  es_result = {{runner}}=>remote_receive( is_header = is_header it_rows = it_rows ).
  COMMIT WORK.
ENDFUNCTION.
