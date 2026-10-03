{{#remote}}
    IF {{ports_class}}=>variant( iv_port = 'alerts' iv_bind = sim_bind( iv_run ) ) = '{{variant}}'.
      " An explicit resume may ask again; the receiver still owns permission to write.
      UPDATE zosd_l3_pile SET status = 'PLANNED' job_count = '' job_name = '' reason = 'REMOTE-RETRY'
        WHERE set_name = c_set AND run_id = iv_run AND ( status = 'GLASS' OR status = 'HELD' ).
      UPDATE zosd_l3_stage SET status = 'OPEN' WHERE set_name = c_set AND run_id = iv_run AND status = 'PARTIAL'.
    ENDIF.
{{/remote}}
