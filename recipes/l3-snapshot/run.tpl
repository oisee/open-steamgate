{{#snapshot_inputs}}
{{#settings}}
        IF lv_dry = abap_false.
{{/settings}}
          record_snapshot( iv_run = rs_result-run_id iv_name = {{name | literal}}
            iv_stage = {{stage}} iv_bind = iv_bind iv_installed = abap_true ).
{{#settings}}
        ENDIF.
{{/settings}}
{{/snapshot_inputs}}
