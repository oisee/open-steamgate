* Demo installation policy: maintenance ships need no manual handling.
CLASS zcl_l3_fleet2_autoclose DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_l3_fleet2_close.
ENDCLASS.
CLASS zcl_l3_fleet2_autoclose IMPLEMENTATION.
  METHOD zif_l3_fleet2_close~apply.
    DATA ls_alert TYPE zosd_l3_alert.
    DATA lv_status TYPE zosd_l2_ship-status.
    LOOP AT it_alerts INTO ls_alert.
      SELECT SINGLE status FROM zosd_l2_ship INTO lv_status WHERE ship_id = ls_alert-object_key.
      IF sy-subrc = 0 AND lv_status = 'M'.
        UPDATE zosd_l3_alert SET closed = 'X'
          WHERE run_id = ls_alert-run_id AND rule_name = ls_alert-rule_name
            AND object_key = ls_alert-object_key.
        APPEND ls_alert TO rt_closed.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
