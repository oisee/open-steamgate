  COMMIT WORK.
{{#staged}}
  IF ls_rule-status = 'DONE'.
    {{class}}=>advance( iv_run = p_run iv_date = p_date iv_stage = ls_rule-stage_no
{{#with_params}}
      is_params = ls_params
{{/with_params}}
      iv_bind = lv_bind ).
  ENDIF.
{{/staged}}
{{#daemon}}
  {{class}}=>pile_done( iv_run = p_run iv_pile = p_pile ).
{{/daemon}}
