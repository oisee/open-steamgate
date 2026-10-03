    TYPES tt_snap_keys TYPE STANDARD TABLE OF zosd_l3_snapk-key_hash WITH DEFAULT KEY.
    CLASS-METHODS snapshot IMPORTING iv_name TYPE csequence iv_bind TYPE csequence OPTIONAL
      it_exclude TYPE tt_snap_keys OPTIONAL iv_installed TYPE abap_bool DEFAULT abap_false RETURNING VALUE(rs_snap) TYPE zosd_l3_snap.
    CLASS-METHODS check_snapshot IMPORTING is_expected TYPE zosd_l3_snap
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS record_snapshot IMPORTING iv_run TYPE csequence iv_name TYPE csequence
      iv_stage TYPE i iv_bind TYPE csequence OPTIONAL iv_installed TYPE abap_bool DEFAULT abap_false.
