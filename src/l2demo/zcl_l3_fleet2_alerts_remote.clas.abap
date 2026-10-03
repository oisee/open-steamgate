* Generated from src/l2demo/fleet2.l3.yaml. The receiver owns writes, closing and budget.
CLASS zcl_l3_fleet2_alerts_remote DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_l3_fleet2_alerts.
    CLASS-DATA header TYPE zl3_fleet2_rhead.
    CLASS-DATA answer TYPE zl3_fleet2_rcpt.
    CLASS-DATA failure_text TYPE string.
ENDCLASS.
CLASS zcl_l3_fleet2_alerts_remote IMPLEMENTATION.
  METHOD zif_l3_fleet2_alerts~put.
    DATA lt_wire TYPE zl3_fleet2_rrows.
    DATA ls_wire TYPE zl3_fleet2_rrow.
    DATA ls_row TYPE zosd_l3_alert.
    DATA ls_snap TYPE zosd_l3_run_snap.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_stage TYPE zosd_l3_stage.
    DATA ls_link TYPE zl3_fleet2_rlink.
    DATA lv_dest TYPE string.
    DATA lv_msg TYPE string.
    DATA ls_settings TYPE zcl_l3_fleet2_conf=>ty_state.
    CLEAR: answer, failure_text.
    SELECT SINGLE * FROM zosd_l3_pile INTO ls_pile
      WHERE run_id = header-run_id AND rule_name = header-rule_name AND pile_no = header-pile_no.
    header-attempt = ls_pile-attempt.
    SELECT SINGLE * FROM zosd_l3_stage INTO ls_stage
      WHERE run_id = header-run_id AND stage_no = header-stage_no.
    header-mode = 'S'.
    IF ls_pile-job_count IS NOT INITIAL.
      header-mode = 'P'.
    ENDIF.
    SELECT SINGLE * FROM zosd_l3_run_snap INTO ls_snap
      WHERE run_id = header-run_id AND stage_no = header-stage_no.
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM zosd_l3_run_snap INTO ls_snap WHERE run_id = header-run_id AND stage_no = 0.
    ENDIF.
    header-snap_id = ls_snap-snap_id.
    header-content_hash = ls_snap-content_hash.
    header-row_count = ls_snap-row_count.
    LOOP AT it_rows INTO ls_row.
      IF strlen( ls_row-alert_text ) > 1024.
        answer-status = 'RFC-PAYLOAD'.
        RETURN.
      ENDIF.
      MOVE-CORRESPONDING ls_row TO ls_wire.
      APPEND ls_wire TO lt_wire.
    ENDLOOP.
    ls_settings = zcl_l3_fleet2_conf=>load( iv_write = abap_false ).
    lv_dest = ls_settings-vals-remote_destination.
    CALL FUNCTION 'Z_L3_FLEET2_ALERTS' DESTINATION lv_dest
      EXPORTING is_header = header it_rows = lt_wire
      IMPORTING es_result = answer
      EXCEPTIONS system_failure = 1 MESSAGE lv_msg
                 communication_failure = 2 MESSAGE lv_msg
                 snapshot_mismatch = 3 OTHERS = 4.
    CASE sy-subrc.
      WHEN 1.
        answer-status = 'RFC-SYSFAIL'.
        failure_text = lv_msg.
      WHEN 2.
        answer-status = 'RFC-COMM'.
        failure_text = lv_msg.
      WHEN 3.
        answer-status = 'SNAP-MISMATCH'.
      WHEN 4.
        answer-status = 'RFC-OTHER'.
    ENDCASE.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    ls_link-set_name = header-set_name.
    ls_link-run_id = header-run_id.
    ls_link-remote_run = answer-remote_run.
    MODIFY zl3_fleet2_rlink FROM ls_link.
    rv_count = answer-alerts.
  ENDMETHOD.
ENDCLASS.
