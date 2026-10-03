{{#remote}}
    IF {{ports_class}}=>variant( iv_port = 'alerts' iv_bind = iv_bind ) = '{{variant}}'.
      {{class}}=>header-set_name = c_set.
      {{class}}=>header-run_id = iv_run.
      {{class}}=>header-rule_name = cs_rule-rule.
      {{class}}=>header-model_hash = cs_rule-model_hash.
      {{class}}=>header-check_date = iv_date.
      {{class}}=>header-pile_no = iv_pile.
      {{class}}=>header-rule_no = iv_rule_no.
      {{class}}=>header-stage_no = cs_rule-stage_no.
      {{class}}=>header-key_offset = iv_key_offset.
      {{class}}=>header-key_length = iv_key_length.
      {{class}}=>header-rule_class = iv_class.
      {{class}}=>header-rule_file = iv_file.
      {{class}}=>header-rule_line = iv_line.
      li_sink = {{ports_class}}=>get_alerts( '{{variant}}' ).
      lv_count = li_sink->put( it_rows = lt_rows is_group = ls_group ).
      cs_rule-status = {{class}}=>answer-status.
      cs_rule-alerts = {{class}}=>answer-alerts.
      cs_rule-closed = {{class}}=>answer-closed.
      cs_rule-open_alerts = {{class}}=>answer-open_alerts.
      cs_rule-budget_alerts = {{class}}=>answer-budget_alerts.
      cs_rule-failed = lines( lt_rows ) - lv_count.
      IF {{class}}=>failure_text IS NOT INITIAL.
        act( EXPORTING iv_run = iv_run iv_date = iv_date iv_stage = cs_rule-stage_no
                       iv_rule = cs_rule-rule iv_pile = iv_pile iv_action = cs_rule-status
                       iv_reason = {{class}}=>failure_text
             CHANGING ct_report = lt_remote_report ).
      ENDIF.
      RETURN.
    ENDIF.
{{/remote}}
