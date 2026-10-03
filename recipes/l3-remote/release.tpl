{{#remote}}
    DATA lt_remote_pending TYPE tt_pile.
    IF {{ports_class}}=>variant( iv_port = 'alerts' iv_bind = sim_bind( iv_run ) ) = '{{variant}}'.
      SELECT * FROM zosd_l3_pile INTO TABLE lt_remote_pending WHERE set_name = c_set AND run_id = iv_run
        AND ( status = 'FAILED' OR status = 'HELD' OR status = 'GLASS' ).
      IF lt_remote_pending IS NOT INITIAL.
        RETURN.
      ENDIF.
    ENDIF.
{{/remote}}
