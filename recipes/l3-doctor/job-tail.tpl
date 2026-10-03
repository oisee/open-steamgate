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
{{#release_event}}
* the lane this pile held is free: the tail releases the next waiting pile itself,
* after the next stage's jobs are committed, so the set does not wait for a pass;
* the claims are committed before their events are raised (a raise outlives a rollback)
  DATA lt_released TYPE {{class}}=>tt_pile.
  COMMIT WORK.
  lt_released = {{class}}=>release_claim( ).
  COMMIT WORK.
  {{class}}=>release_raise( lt_released ).
  COMMIT WORK.
{{/release_event}}
{{#daemon}}
  {{class}}=>pile_done( iv_run = p_run iv_pile = p_pile ).
{{/daemon}}
