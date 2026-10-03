{{#remote}}
    DATA ls_remote_link TYPE {{link}}.
    DATA lt_remote_piles TYPE tt_pile.
    DATA ls_remote_pile TYPE zosd_l3_pile.
    SELECT SINGLE * FROM {{link}} INTO ls_remote_link WHERE set_name = c_set AND run_id = iv_run.
    IF sy-subrc = 0.
      SELECT * FROM zosd_l3_pile INTO TABLE lt_remote_piles WHERE set_name = c_set AND run_id = iv_run AND status = 'DONE'.
      LOOP AT ct_rules ASSIGNING <ls_rule>.
        CLEAR: <ls_rule>-budget_alerts, <ls_rule>-closed, <ls_rule>-open_alerts.
        LOOP AT lt_remote_piles INTO ls_remote_pile WHERE rule_name = <ls_rule>-rule.
          <ls_rule>-closed = <ls_rule>-closed + ls_remote_pile-closed.
          <ls_rule>-open_alerts = <ls_rule>-open_alerts + ls_remote_pile-open_alerts.
        ENDLOOP.
        <ls_rule>-budget_alerts = <ls_rule>-closed + <ls_rule>-open_alerts.
      ENDLOOP.
      RETURN.
    ENDIF.
{{/remote}}
