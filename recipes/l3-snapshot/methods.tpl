  METHOD snapshot.
    DATA lv_text TYPE string.
    DATA lv_value TYPE string.
    DATA lv_key TYPE string.
    DATA lv_hash TYPE string.
    DATA lv_keyhash TYPE zosd_l3_snapk-key_hash.
    DATA lt_keys TYPE tt_snap_keys.
    DATA ls_key TYPE zosd_l3_snapk.
{{#snapshots}}
    DATA lt_{{name}} TYPE STANDARD TABLE OF {{table}} WITH DEFAULT KEY.
    DATA ls_{{name}} TYPE {{table}}.
{{#port}}
    DATA li_{{name}} TYPE REF TO {{iface}}.
{{/port}}
{{/snapshots}}
    CASE iv_name.
{{#snapshots}}
      WHEN {{name | literal}}.
{{#port}}
        IF iv_installed = abap_false.
          li_{{name}} = {{ports_class}}=>get_{{port}}(
            {{ports_class}}=>variant( iv_port = {{port | literal}} iv_bind = iv_bind ) ).
          lt_{{name}} = li_{{name}}->read( ).
        ELSE.
          SELECT * FROM {{table}} INTO TABLE lt_{{name}}.
        ENDIF.
{{/port}}
{{^port}}
        SELECT * FROM {{table}} INTO TABLE lt_{{name}}.
{{/port}}
        SORT lt_{{name}} BY {{order}}.
        LOOP AT lt_{{name}} INTO ls_{{name}}.
          CLEAR lv_key.
{{#keys}}
          lv_value = |{ ls_{{row}}-{{name}} }|.
          lv_key = lv_key && |{ strlen( lv_value ) }:{ lv_value }|.
{{/keys}}
          cl_abap_message_digest=>calculate_hash_for_char(
            EXPORTING if_algorithm = 'SHA256' if_data = lv_key
            IMPORTING ef_hashstring = lv_hash ).
          lv_keyhash = to_lower( lv_hash ).
          READ TABLE it_exclude WITH KEY table_line = lv_keyhash TRANSPORTING NO FIELDS.
          IF sy-subrc = 0.
            CONTINUE.
          ENDIF.
          READ TABLE lt_keys WITH KEY table_line = lv_keyhash TRANSPORTING NO FIELDS.
          IF sy-subrc = 0.
            RAISE EXCEPTION TYPE {{exception}}
              EXPORTING iv_port = iv_name iv_reason = 'duplicate snapshot business key'.
          ENDIF.
          APPEND lv_keyhash TO lt_keys.
{{#fields}}
          lv_value = |{ ls_{{row}}-{{name}} }|.
          lv_text = lv_text && |{ strlen( lv_value ) }:{ lv_value }|.
{{/fields}}
          lv_text = lv_text && ';'.
        ENDLOOP.
{{/snapshots}}
      WHEN OTHERS.
        RETURN.
    ENDCASE.
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = lv_text
      IMPORTING ef_hashstring = lv_hash ).
    lv_hash = to_lower( lv_hash ).
    SELECT SINGLE * FROM zosd_l3_snap INTO rs_snap
      WHERE set_name = c_set AND snap_name = iv_name AND content_hash = lv_hash AND state = 'READY'.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.
    rs_snap-set_name = c_set.
    rs_snap-snap_name = iv_name.
    rs_snap-content_hash = lv_hash.
    rs_snap-row_count = lines( lt_keys ).
    GET TIME STAMP FIELD rs_snap-created.
    TRY.
        rs_snap-snap_id = cl_system_uuid=>create_uuid_c32_static( ).
      CATCH cx_uuid_error.
        CLEAR rs_snap.
        RETURN.
    ENDTRY.
    rs_snap-state = 'READY'.
    INSERT zosd_l3_snap FROM rs_snap.
    IF sy-subrc <> 0.
      CLEAR rs_snap.
      SELECT SINGLE * FROM zosd_l3_snap INTO rs_snap
        WHERE set_name = c_set AND snap_name = iv_name AND content_hash = lv_hash AND state = 'READY'.
      RETURN.
    ENDIF.
    LOOP AT lt_keys INTO lv_keyhash.
      ls_key-snap_id = rs_snap-snap_id.
      ls_key-key_hash = lv_keyhash.
      INSERT zosd_l3_snapk FROM ls_key.
    ENDLOOP.
  ENDMETHOD.

  METHOD record_snapshot.
    DATA ls_snap TYPE zosd_l3_snap.
    DATA ls_input TYPE zosd_l3_run_snap.
    SELECT SINGLE * FROM zosd_l3_run_snap INTO ls_input
      WHERE set_name = c_set AND run_id = iv_run AND stage_no = iv_stage.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.
    ls_snap = snapshot( iv_name = iv_name iv_bind = iv_bind iv_installed = iv_installed ).
    IF ls_snap-snap_id IS INITIAL.
      RAISE EXCEPTION TYPE {{exception}}
        EXPORTING iv_port = iv_name iv_reason = 'snapshot could not be captured'.
    ENDIF.
    ls_input-run_id = iv_run.
    ls_input-stage_no = iv_stage.
    ls_input-set_name = c_set.
    ls_input-snap_name = iv_name.
    ls_input-snap_id = ls_snap-snap_id.
    ls_input-content_hash = ls_snap-content_hash.
    ls_input-row_count = ls_snap-row_count.
    INSERT zosd_l3_run_snap FROM ls_input.
  ENDMETHOD.

  METHOD check_snapshot.
    DATA ls_stored TYPE zosd_l3_snap.
    DATA ls_audit TYPE zosd_l3_doctor.
    SELECT SINGLE * FROM zosd_l3_snap INTO ls_stored
      WHERE set_name = c_set AND snap_id = is_expected-snap_id AND state = 'READY'.
    IF sy-subrc = 0 AND ls_stored-content_hash = is_expected-content_hash
      AND ls_stored-row_count = is_expected-row_count.
      rv_ok = abap_true.
      RETURN.
    ENDIF.
    ls_audit-set_name = c_set.
    ls_audit-doc_action = 'SNAP-MISMATCH'.
    ls_audit-expected_id = is_expected-snap_id.
    ls_audit-expected_hash = is_expected-content_hash.
    ls_audit-expected_count = is_expected-row_count.
    ls_audit-stored_id = ls_stored-snap_id.
    ls_audit-stored_hash = ls_stored-content_hash.
    ls_audit-stored_count = ls_stored-row_count.
    GET TIME STAMP FIELD ls_audit-acted.
    ls_audit-run_id = iv_run.
    IF ls_audit-run_id IS INITIAL.
      TRY.
          ls_audit-run_id = cl_system_uuid=>create_uuid_c32_static( ).
        CATCH cx_uuid_error.
          RETURN.
      ENDTRY.
    ENDIF.
    SELECT MAX( seq ) FROM zosd_l3_doctor INTO ls_audit-seq WHERE run_id = ls_audit-run_id.
    DO 10 TIMES.
      ls_audit-seq = ls_audit-seq + 1.
      INSERT zosd_l3_doctor FROM ls_audit.
      IF sy-subrc = 0.
        RETURN.
      ENDIF.
    ENDDO.
  ENDMETHOD.
