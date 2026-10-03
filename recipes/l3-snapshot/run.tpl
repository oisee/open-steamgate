{{#snapshot_inputs}}
{{#resilience}}
{{#settings}}
        IF lv_dry = abap_false.
{{/settings}}
{{^settings}}
        IF lv_snapshot_dry = abap_false.
{{/settings}}
{{/resilience}}
          record_snapshot( iv_run = rs_result-run_id iv_name = {{name | literal}}
            iv_stage = {{stage}} iv_bind = iv_bind iv_installed = abap_true ).
{{#resilience}}
        ENDIF.
{{/resilience}}
{{/snapshot_inputs}}
