{{#remote}}
  METHOD remote_receive.
    DATA ls_link TYPE {{link}}.
    DATA ls_claim TYPE {{receipt}}.
    DATA ls_wire TYPE {{row}}.
    DATA ls_saved TYPE {{conf}}=>ty_state.
    DATA lv_saved_run TYPE string.
    DATA ls_rule TYPE ty_rule.
    DATA lt_alerts TYPE string_table.
    DATA ls_snap TYPE zosd_l3_run_snap.
    DATA ls_plan TYPE zosd_l3_pile.
    DATA ls_gate TYPE zosd_l3_stage.
    DATA lt_plan TYPE tt_pile.
    IF is_header-set_name <> c_set OR is_header-run_id IS INITIAL OR is_header-attempt < 0.
      rs_result-status = 'RFC-PAYLOAD'.
      RETURN.
    ENDIF.
    ls_claim-set_name = c_set.
    ls_claim-run_id = is_header-run_id.
    ls_claim-rule_name = is_header-rule_name.
    ls_claim-pile_no = is_header-pile_no.
    ls_claim-attempt = is_header-attempt.
    " Unique INSERT serializes duplicate calls; the receipt and writes share a LUW.
    INSERT {{receipt}} FROM ls_claim.
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM {{receipt}} INTO rs_result
        WHERE set_name = c_set AND run_id = is_header-run_id AND rule_name = is_header-rule_name
          AND pile_no = is_header-pile_no.
      RETURN.
    ENDIF.
    SELECT SINGLE * FROM {{link}} INTO ls_link WHERE set_name = c_set AND run_id = is_header-run_id AND dest = ''.
    IF sy-subrc <> 0.
      ls_link-set_name = c_set.
      ls_link-run_id = is_header-run_id.
      TRY.
          ls_link-remote_run = cl_system_uuid=>create_uuid_c32_static( ).
        CATCH cx_uuid_error.
          RAISE EXCEPTION TYPE {{exception}} EXPORTING iv_reason = 'receiver UUID unavailable'.
      ENDTRY.
      INSERT {{link}} FROM ls_link.
      IF sy-subrc <> 0.
        SELECT SINGLE * FROM {{link}} INTO ls_link WHERE set_name = c_set AND run_id = is_header-run_id AND dest = ''.
      ENDIF.
    ENDIF.
    ls_saved = gs_settings.
    lv_saved_run = gv_settings_run.
    gs_settings = {{conf}}=>load( iv_write = abap_false ).
    gv_settings_run = ls_link-remote_run.
    budget_start( ls_link-remote_run ).
    ls_snap-set_name = c_set.
    ls_snap-run_id = ls_link-remote_run.
    ls_snap-stage_no = is_header-stage_no.
    ls_snap-snap_id = is_header-snap_id.
    ls_snap-content_hash = is_header-content_hash.
    ls_snap-row_count = is_header-row_count.
    INSERT zosd_l3_run_snap FROM ls_snap.
    SELECT SINGLE * FROM zosd_l3_pile INTO ls_plan
      WHERE set_name = c_set AND run_id = ls_link-remote_run AND rule_name = is_header-rule_name AND pile_no = is_header-pile_no.
    ls_plan-set_name = c_set.
    ls_plan-run_id = ls_link-remote_run.
    ls_plan-rule_name = is_header-rule_name.
    ls_plan-model_hash = is_header-model_hash.
    ls_plan-check_date = is_header-check_date.
    ls_plan-stage_no = is_header-stage_no.
    ls_plan-pile_no = is_header-pile_no.
    ls_plan-attempt = is_header-attempt.
    ls_plan-status = 'RUNNING'.
    GET TIME STAMP FIELD ls_plan-started.
    MODIFY zosd_l3_pile FROM ls_plan.
    LOOP AT it_rows INTO ls_wire.
      APPEND ls_wire-alert_text TO lt_alerts.
    ENDLOOP.
    ls_rule-rule = is_header-rule_name.
    ls_rule-model_hash = is_header-model_hash.
    ls_rule-stage_no = is_header-stage_no.
    write( EXPORTING iv_run = ls_link-remote_run iv_date = is_header-check_date iv_pile = is_header-pile_no
      iv_class = is_header-rule_class iv_file = is_header-rule_file iv_line = is_header-rule_line
      it_alerts = lt_alerts iv_key_offset = is_header-key_offset iv_key_length = is_header-key_length
      iv_rule_no = is_header-rule_no iv_bind = 'alerts=log'
      CHANGING cs_rule = ls_rule ).
    ls_plan-status = ls_rule-status.
    ls_plan-alerts = ls_rule-alerts.
    ls_plan-closed = ls_rule-closed.
    ls_plan-open_alerts = ls_rule-open_alerts.
    GET TIME STAMP FIELD ls_plan-ended.
    MODIFY zosd_l3_pile FROM ls_plan.
    ls_gate-set_name = c_set.
    ls_gate-run_id = ls_link-remote_run.
    ls_gate-check_date = is_header-check_date.
    ls_gate-stage_no = is_header-stage_no.
    ls_gate-stage_name = 'receiving'.
    ls_gate-run_bind = 'alerts=log,work=real'.
    ls_gate-status = 'DONE'.
    SELECT * FROM zosd_l3_pile INTO TABLE lt_plan WHERE set_name = c_set AND run_id = ls_link-remote_run
      AND stage_no = is_header-stage_no AND status <> 'DONE'.
    IF lt_plan IS NOT INITIAL.
      ls_gate-status = 'PARTIAL'.
    ENDIF.
    GET TIME STAMP FIELD ls_gate-ended.
    MODIFY zosd_l3_stage FROM ls_gate.
    gs_settings = ls_saved.
    gv_settings_run = lv_saved_run.
    rs_result = ls_claim.
    rs_result-remote_run = ls_link-remote_run.
    rs_result-status = ls_rule-status.
    rs_result-alerts = ls_rule-alerts.
    rs_result-closed = ls_rule-closed.
    rs_result-open_alerts = ls_rule-open_alerts.
    rs_result-budget_alerts = ls_rule-budget_alerts.
    IF ls_rule-status = 'DONE'.
      MODIFY {{receipt}} FROM rs_result.
    ELSE.
      DELETE FROM {{receipt}} WHERE set_name = c_set AND run_id = is_header-run_id
        AND rule_name = is_header-rule_name AND pile_no = is_header-pile_no.
    ENDIF.
  ENDMETHOD.
{{/remote}}
