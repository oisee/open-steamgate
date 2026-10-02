* The L3 runner ZCL_L3_FLEET against the rule classes it runs: seeded rows
* make six rules alert (seven alerts), mode S, every rule cut into piles of
* keys, writes exactly the union of the rules' own check answers over all
* rows, a rerun leaves the log as it was with every row on the new run, a
* rerun with one pile per rule finalises away the older run's piles, a
* plan whose pile fails stays PARTIAL and keeps the older rows, and mode P
* (one background job per rule and pile) ends with every pile DONE and the
* same log as mode S.
* RISK LEVEL DANGEROUS: setup commits rows into the rule tables, every run
* commits its alerts, and teardown deletes both again and commits. The
* keys all start with L30, which no generated L2 test uses.
* Job logs and SM37 history of mode P are left as the system keeps them.
CLASS ltcl_proof DEFINITION FINAL FOR TESTING RISK LEVEL DANGEROUS DURATION MEDIUM.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             rule_name TYPE zosd_l3_alert-rule_name,
             model_hash TYPE zosd_l3_alert-model_hash,
             alert_text TYPE string,
           END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    TYPES tt_run TYPE STANDARD TABLE OF zosd_l3_alert-run_id WITH DEFAULT KEY.
    " the longest a run of six jobs may take, in seconds, before the proof
    " gives up; below the 300 seconds of DURATION MEDIUM
    CONSTANTS c_wait_limit TYPE i VALUE 180.
    DATA mt_ship TYPE STANDARD TABLE OF zosd_l2_ship WITH DEFAULT KEY.
    DATA mt_voy TYPE STANDARD TABLE OF zosd_l2_voy WITH DEFAULT KEY.
    DATA mt_crew TYPE STANDARD TABLE OF zosd_l2_crew WITH DEFAULT KEY.
    DATA mt_cargo TYPE STANDARD TABLE OF zosd_l2_cargo WITH DEFAULT KEY.
    DATA mt_runs TYPE tt_run.
    METHODS setup.
    METHODS teardown.
    METHODS mode_s FOR TESTING.
    METHODS rerun FOR TESTING.
    METHODS rerun_fewer_piles FOR TESTING.
    METHODS mode_p FOR TESTING.
    METHODS partial_keeps_old FOR TESTING.
    METHODS add_ship IMPORTING iv_id TYPE csequence iv_name TYPE csequence iv_status TYPE csequence.
    METHODS add_voyage IMPORTING iv_id TYPE csequence iv_ship TYPE csequence iv_date TYPE csequence.
    METHODS add_crew IMPORTING iv_id TYPE csequence iv_ship TYPE csequence iv_role TYPE csequence iv_since TYPE csequence.
    METHODS add_cargo IMPORTING iv_id TYPE csequence iv_ship TYPE csequence iv_weight TYPE csequence.
    METHODS delete_seed.
    METHODS run_set
      IMPORTING iv_mode TYPE c
      RETURNING VALUE(rs_result) TYPE zcl_l3_fleet=>ty_result.
    METHODS wait_for_jobs
      IMPORTING is_result TYPE zcl_l3_fleet=>ty_result
      RETURNING VALUE(rs_result) TYPE zcl_l3_fleet=>ty_result.
    METHODS expected
      RETURNING VALUE(rt_rows) TYPE tt_row.
    METHODS add_expected
      IMPORTING iv_rule TYPE zosd_l3_alert-rule_name
                iv_hash TYPE zosd_l3_alert-model_hash
                it_alerts TYPE string_table
      CHANGING ct_rows TYPE tt_row.
    METHODS logged
      IMPORTING iv_run TYPE zosd_l3_alert-run_id OPTIONAL
      RETURNING VALUE(rt_rows) TYPE tt_row.
    METHODS foreign
      IMPORTING iv_run TYPE zosd_l3_alert-run_id
      RETURNING VALUE(rv_count) TYPE i.
    METHODS statuses
      IMPORTING is_result TYPE zcl_l3_fleet=>ty_result
      RETURNING VALUE(rv_text) TYPE string.
    METHODS assert_all
      IMPORTING is_result TYPE zcl_l3_fleet=>ty_result
                iv_status TYPE csequence
                iv_when TYPE csequence.
ENDCLASS.

CLASS ltcl_proof IMPLEMENTATION.

  METHOD setup.
    " a maintenance ship with a voyage ahead and a pilot aboard; an active
    " ship with one crew member and three voyages ahead; an active ship with
    " no crew and 1100.50 kg booked; an active ship that breaks nothing
    add_ship( iv_id = 'L301' iv_name = 'Albatross' iv_status = 'M' ).
    add_ship( iv_id = 'L302' iv_name = 'Bluebird' iv_status = 'A' ).
    add_ship( iv_id = 'L303' iv_name = 'Condor' iv_status = 'A' ).
    add_ship( iv_id = 'L304' iv_name = 'Dove' iv_status = 'A' ).
    add_voyage( iv_id = 'L30001' iv_ship = 'L301' iv_date = '20991005' ).
    add_voyage( iv_id = 'L30002' iv_ship = 'L302' iv_date = '20991010' ).
    add_voyage( iv_id = 'L30003' iv_ship = 'L302' iv_date = '20991011' ).
    add_voyage( iv_id = 'L30004' iv_ship = 'L302' iv_date = '20991012' ).
    add_voyage( iv_id = 'L30005' iv_ship = 'L304' iv_date = '20990901' ).
    add_crew( iv_id = 'L30001' iv_ship = 'L301' iv_role = 'P' iv_since = '20990101' ).
    add_crew( iv_id = 'L30002' iv_ship = 'L302' iv_role = 'C' iv_since = '20990101' ).
    add_crew( iv_id = 'L30003' iv_ship = 'L304' iv_role = 'C' iv_since = '20990101' ).
    add_crew( iv_id = 'L30004' iv_ship = 'L304' iv_role = 'P' iv_since = '20990101' ).
    add_cargo( iv_id = 'L30001' iv_ship = 'L303' iv_weight = '600.50' ).
    add_cargo( iv_id = 'L30002' iv_ship = 'L303' iv_weight = '500.00' ).
    add_cargo( iv_id = 'L30003' iv_ship = 'L304' iv_weight = '1.25' ).
    " rows an interrupted run may have left under the same keys
    delete_seed( ).
    INSERT zosd_l2_ship FROM TABLE mt_ship.
    INSERT zosd_l2_voy FROM TABLE mt_voy.
    INSERT zosd_l2_crew FROM TABLE mt_crew.
    INSERT zosd_l2_cargo FROM TABLE mt_cargo.
    COMMIT WORK.
  ENDMETHOD.

  METHOD teardown.
    DATA lv_run TYPE zosd_l3_alert-run_id.
    delete_seed( ).
    LOOP AT mt_runs INTO lv_run.
      DELETE FROM zosd_l3_alert WHERE set_name = zcl_l3_fleet=>c_set AND run_id = lv_run.
      DELETE FROM zosd_l3_pile WHERE set_name = zcl_l3_fleet=>c_set AND run_id = lv_run.
    ENDLOOP.
    CLEAR mt_runs.
    COMMIT WORK.
  ENDMETHOD.

  METHOD mode_s.
    DATA lt_exp TYPE tt_row.
    DATA lt_log TYPE tt_row.
    DATA ls_row TYPE ty_row.
    DATA ls_result TYPE zcl_l3_fleet=>ty_result.
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA lt_rules TYPE STANDARD TABLE OF zosd_l3_alert-rule_name WITH DEFAULT KEY.
    DATA lv_ours TYPE i.
    DATA lv_lines TYPE i.
    lt_exp = expected( ).
    LOOP AT lt_exp INTO ls_row WHERE alert_text CP 'L30*'.
      lv_ours = lv_ours + 1.
      READ TABLE lt_rules TRANSPORTING NO FIELDS WITH KEY table_line = ls_row-rule_name.
      IF sy-subrc <> 0.
        APPEND ls_row-rule_name TO lt_rules.
      ENDIF.
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = lv_ours exp = 7
      msg = 'the seeded rows make seven alerts' ).
    lv_lines = lines( lt_rules ).
    cl_abap_unit_assert=>assert_equals( act = lv_lines exp = 6
      msg = 'the seven alerts come from six rules' ).

    ls_result = run_set( zcl_l3_fleet=>c_sequential ).
    lv_lines = lines( ls_result-rules ).
    cl_abap_unit_assert=>assert_equals( act = lv_lines exp = 6
      msg = 'mode S runs the six enabled rules' ).
    assert_all( is_result = ls_result iv_status = 'DONE' iv_when = 'mode S' ).
    LOOP AT ls_result-rules INTO ls_rule.
      IF ls_rule-piles < 2 OR ls_rule-piles_done <> ls_rule-piles.
        cl_abap_unit_assert=>fail( msg = 'mode S cuts every rule into piles and runs each' ).
      ENDIF.
    ENDLOOP.
    lv_lines = lines( lt_exp ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-alerts exp = lv_lines
      msg = 'the result counts the alerts the checks answer' ).
    lt_log = logged( ls_result-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_log exp = lt_exp
      msg = 'the log of the piled run is the union of the rules'' answers over all rows' ).
  ENDMETHOD.

  METHOD rerun.
    DATA ls_first TYPE zcl_l3_fleet=>ty_result.
    DATA ls_second TYPE zcl_l3_fleet=>ty_result.
    DATA lt_once TYPE tt_row.
    DATA lt_twice TYPE tt_row.
    DATA lt_exp TYPE tt_row.
    DATA lv_count TYPE i.
    ls_first = run_set( zcl_l3_fleet=>c_sequential ).
    lt_once = logged( ).
    ls_second = run_set( zcl_l3_fleet=>c_sequential ).
    lt_twice = logged( ).
    " not assert_differs, which cannot fail on this runtime
    " (ANOMALY-2026-10-01-assert-differs-never-fails)
    IF ls_second-run_id = ls_first-run_id.
      cl_abap_unit_assert=>fail( msg = 'a rerun is a run of its own' ).
    ENDIF.
    assert_all( is_result = ls_second iv_status = 'DONE' iv_when = 'the rerun' ).
    cl_abap_unit_assert=>assert_equals( act = lt_twice exp = lt_once
      msg = 'a rerun leaves the log identical' ).
    lt_exp = expected( ).
    cl_abap_unit_assert=>assert_equals( act = lt_twice exp = lt_exp
      msg = 'after the rerun the log is still the union of the checks' ).
    lv_count = foreign( ls_second-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0
      msg = 'after the rerun every row of the log names the rerun' ).
  ENDMETHOD.

  METHOD rerun_fewer_piles.
    " a rerun with one pile per rule (a size above any key count): its pile 1
    " rewrites the older pile 1, and finalise removes the older run's other
    " piles, which no group of the rerun touched
    DATA ls_first TYPE zcl_l3_fleet=>ty_result.
    DATA ls_second TYPE zcl_l3_fleet=>ty_result.
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA lt_once TYPE tt_row.
    DATA lt_twice TYPE tt_row.
    DATA lv_beyond TYPE i.
    DATA lv_foreign TYPE i.
    ls_first = run_set( zcl_l3_fleet=>c_sequential ).
    lt_once = logged( ls_first-run_id ).
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet=>c_set
        AND check_date = zcl_l3_fleet_proof=>c_check_date
        AND run_id = ls_first-run_id
        AND pile_no > 1.
    lv_beyond = sy-dbcnt.
    IF lv_beyond = 0.
      cl_abap_unit_assert=>fail( msg = 'the first run writes rows beyond its first pile' ).
    ENDIF.
    ls_second = zcl_l3_fleet=>run( iv_date = zcl_l3_fleet_proof=>c_check_date
                                   iv_mode = zcl_l3_fleet=>c_sequential
                                   iv_pile_size = 1000000 ).
    APPEND ls_second-run_id TO mt_runs.
    COMMIT WORK.
    assert_all( is_result = ls_second iv_status = 'DONE' iv_when = 'the rerun with one pile' ).
    LOOP AT ls_second-rules INTO ls_rule.
      IF ls_rule-piles <> 1.
        cl_abap_unit_assert=>fail( msg = 'a size above the key count plans one pile per rule' ).
      ENDIF.
    ENDLOOP.
    lt_twice = logged( ls_second-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_twice exp = lt_once
      msg = 'one pile per rule gives the alerts two keys per pile gave' ).
    lv_foreign = foreign( ls_second-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lv_foreign exp = 0
      msg = 'finalise leaves exactly the rerun''s rows' ).
  ENDMETHOD.

  METHOD mode_p.
    DATA ls_seq TYPE zcl_l3_fleet=>ty_result.
    DATA ls_par TYPE zcl_l3_fleet=>ty_result.
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA ls_same TYPE zcl_l3_fleet=>ty_rule.
    DATA lt_seq TYPE tt_row.
    DATA lt_par TYPE tt_row.
    DATA lv_lines TYPE i.
    DATA lv_count TYPE i.
    DATA lv_msg TYPE string.
    ls_seq = run_set( zcl_l3_fleet=>c_sequential ).
    lt_seq = logged( ls_seq-run_id ).

    ls_par = run_set( zcl_l3_fleet=>c_parallel ).
    lv_lines = lines( ls_par-rules ).
    cl_abap_unit_assert=>assert_equals( act = lv_lines exp = 6
      msg = 'mode P submits the six enabled rules' ).
    assert_all( is_result = ls_par iv_status = 'SUBMITTED' iv_when = 'submitting' ).
    LOOP AT ls_par-rules INTO ls_rule.
      IF ls_rule-piles < 2.
        cl_abap_unit_assert=>fail( msg = 'each fleet rule needs more than one pile and job' ).
      ENDIF.
    ENDLOOP.

    ls_par = wait_for_jobs( ls_par ).
    assert_all( is_result = ls_par iv_status = 'DONE' iv_when = 'the jobs' ).
    LOOP AT ls_par-rules INTO ls_rule.
      READ TABLE ls_seq-rules INTO ls_same WITH KEY rule = ls_rule-rule.
      CONCATENATE ls_rule-rule ': the job wrote as many alerts as mode S' INTO lv_msg.
      cl_abap_unit_assert=>assert_equals( act = ls_rule-alerts exp = ls_same-alerts msg = lv_msg ).
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = ls_par-alerts exp = ls_seq-alerts
      msg = 'collect counts the alerts mode S counted' ).
    lt_par = logged( ls_par-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_par exp = lt_seq
      msg = 'the jobs wrote the log mode S wrote' ).
    lv_count = foreign( ls_par-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0
      msg = 'after the jobs every row of the log names the parallel run' ).
  ENDMETHOD.

  METHOD partial_keeps_old.
    " a complete run, then a second plan of the same keys whose pile holding
    " L301 fails for the first rule (its write is bound to a sink variant the
    " port does not have) while the rule's other piles run: collect( ) finds
    " the pile FAILED and the rule PARTIAL, and runs no finalise, so the
    " complete run's rows in that pile stay
    DATA ls_old TYPE zcl_l3_fleet=>ty_result.
    DATA ls_new TYPE zcl_l3_fleet=>ty_result.
    DATA lt_piles TYPE zcl_l3_fleet=>tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA ls_done TYPE zcl_l3_fleet=>ty_rule.
    DATA lv_pile TYPE i.
    DATA lv_old TYPE i.
    DATA lv_kept TYPE i.
    DATA lv_left TYPE i.
    DATA lv_failed TYPE abap_bool.
    DATA lv_status TYPE zosd_l3_pile-status.
    ls_old = run_set( zcl_l3_fleet=>c_sequential ).
    ls_new-set_name = zcl_l3_fleet=>c_set.
    ls_new-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_new-mode = zcl_l3_fleet=>c_parallel.
    ls_new-rules = zcl_l3_fleet=>rules( ).
    ls_new-run_id = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND ls_new-run_id TO mt_runs.
    lt_piles = zcl_l3_fleet=>plan( iv_run = ls_new-run_id
                                   iv_date = zcl_l3_fleet_proof=>c_check_date ).
    INSERT zosd_l3_pile FROM TABLE lt_piles.
    LOOP AT lt_piles INTO ls_pile WHERE rule_name = zcl_l3_fleet=>c_rule_1
                                    AND range_low <= 'L301' AND range_high >= 'L301'.
      lv_pile = ls_pile-pile_no.
    ENDLOOP.
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet=>c_set
        AND rule_name = zcl_l3_fleet=>c_rule_1
        AND check_date = zcl_l3_fleet_proof=>c_check_date
        AND pile_no = lv_pile
        AND run_id = ls_old-run_id.
    lv_old = sy-dbcnt.
    IF lv_old = 0.
      cl_abap_unit_assert=>fail( msg = 'the complete run wrote the L301 alert in the pile that will fail' ).
    ENDIF.
    LOOP AT lt_piles INTO ls_pile WHERE rule_name = zcl_l3_fleet=>c_rule_1.
      IF ls_pile-pile_no = lv_pile.
        TRY.
            ls_done = zcl_l3_fleet=>run_rule( iv_rule = zcl_l3_fleet=>c_rule_1
                                              iv_date = zcl_l3_fleet_proof=>c_check_date
                                              iv_run = ls_new-run_id
                                              iv_pile = ls_pile-pile_no
                                              iv_bind = 'alerts=nope' ).
          CATCH cx_root.
            lv_failed = abap_true.
        ENDTRY.
      ELSE.
        ls_done = zcl_l3_fleet=>run_rule( iv_rule = zcl_l3_fleet=>c_rule_1
                                          iv_date = zcl_l3_fleet_proof=>c_check_date
                                          iv_run = ls_new-run_id
                                          iv_pile = ls_pile-pile_no ).
        cl_abap_unit_assert=>assert_equals( act = ls_done-status exp = 'DONE'
          msg = 'the other piles of the rule run' ).
      ENDIF.
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = lv_failed exp = abap_true
      msg = 'a sink variant the port does not have makes the pile fail' ).
    COMMIT WORK.
    ls_new = zcl_l3_fleet=>collect( ls_new ).
    READ TABLE ls_new-rules INTO ls_rule WITH KEY rule = zcl_l3_fleet=>c_rule_1.
    cl_abap_unit_assert=>assert_equals( act = ls_rule-status exp = 'PARTIAL'
      msg = 'collect reports the rule with a failed pile PARTIAL' ).
    lv_left = ls_rule-piles - 1.
    cl_abap_unit_assert=>assert_equals( act = ls_rule-piles_done exp = lv_left
      msg = 'every pile of the rule but the failed one is DONE' ).
    SELECT SINGLE status FROM zosd_l3_pile INTO lv_status
      WHERE set_name = zcl_l3_fleet=>c_set
        AND run_id = ls_new-run_id
        AND rule_name = zcl_l3_fleet=>c_rule_1
        AND pile_no = lv_pile.
    cl_abap_unit_assert=>assert_equals( act = lv_status exp = 'FAILED'
      msg = 'the failed pile is FAILED in the plan' ).
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet=>c_set
        AND rule_name = zcl_l3_fleet=>c_rule_1
        AND check_date = zcl_l3_fleet_proof=>c_check_date
        AND pile_no = lv_pile
        AND run_id = ls_old-run_id.
    lv_kept = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_kept exp = lv_old
      msg = 'a failed pile keeps the previous run until a complete plan finalises' ).
  ENDMETHOD.

  METHOD add_ship.
    DATA ls_ship TYPE zosd_l2_ship.
    ls_ship-mandt = sy-mandt.
    ls_ship-ship_id = iv_id.
    ls_ship-name = iv_name.
    ls_ship-status = iv_status.
    APPEND ls_ship TO mt_ship.
  ENDMETHOD.

  METHOD add_voyage.
    DATA ls_voy TYPE zosd_l2_voy.
    ls_voy-mandt = sy-mandt.
    ls_voy-voyage_id = iv_id.
    ls_voy-ship_id = iv_ship.
    ls_voy-dep_date = iv_date.
    APPEND ls_voy TO mt_voy.
  ENDMETHOD.

  METHOD add_crew.
    DATA ls_crew TYPE zosd_l2_crew.
    ls_crew-mandt = sy-mandt.
    ls_crew-crew_id = iv_id.
    ls_crew-ship_id = iv_ship.
    ls_crew-role = iv_role.
    ls_crew-since = iv_since.
    APPEND ls_crew TO mt_crew.
  ENDMETHOD.

  METHOD add_cargo.
    DATA ls_cargo TYPE zosd_l2_cargo.
    ls_cargo-mandt = sy-mandt.
    ls_cargo-cargo_id = iv_id.
    ls_cargo-ship_id = iv_ship.
    ls_cargo-weight = iv_weight.
    APPEND ls_cargo TO mt_cargo.
  ENDMETHOD.

  METHOD delete_seed.
    DELETE zosd_l2_ship FROM TABLE mt_ship.
    DELETE zosd_l2_voy FROM TABLE mt_voy.
    DELETE zosd_l2_crew FROM TABLE mt_crew.
    DELETE zosd_l2_cargo FROM TABLE mt_cargo.
  ENDMETHOD.

  METHOD run_set.
    " the caller's step commits: mode S's rows, and in mode P the jobs that
    " JOB_CLOSE released
    rs_result = zcl_l3_fleet=>run( iv_date = zcl_l3_fleet_proof=>c_check_date
                                   iv_mode = iv_mode ).
    APPEND rs_result-run_id TO mt_runs.
    COMMIT WORK.
  ENDMETHOD.

  METHOD wait_for_jobs.
    " collect( ) is one read; the waiting is the caller's, bounded. WAIT
    " ends the LUW and lets the background work processes run the jobs
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA lv_open TYPE i.
    DATA lv_waited TYPE i.
    DATA lv_limit TYPE string.
    DATA lv_states TYPE string.
    DATA lv_msg TYPE string.
    DO.
      rs_result = zcl_l3_fleet=>collect( is_result ).
      lv_open = 0.
      LOOP AT rs_result-rules INTO ls_rule.
        IF ls_rule-status <> 'DONE' AND ls_rule-status <> 'PARTIAL'.
          lv_open = lv_open + 1.
        ENDIF.
      ENDLOOP.
      " every rule DONE, or a pile lost: waiting longer changes nothing
      IF lv_open = 0.
        RETURN.
      ENDIF.
      IF lv_waited >= c_wait_limit.
        lv_limit = c_wait_limit.
        CONDENSE lv_limit.
        lv_states = statuses( rs_result ).
        CONCATENATE 'the jobs did not end within' lv_limit 'seconds:' lv_states INTO lv_msg SEPARATED BY space.
        cl_abap_unit_assert=>fail( msg = lv_msg ).
        RETURN.
      ENDIF.
      WAIT UP TO 1 SECONDS.
      lv_waited = lv_waited + 1.
    ENDDO.
  ENDMETHOD.

  METHOD expected.
    " what each rule's own check class answers, as the rows the log of a
    " run must hold: the six enabled rules of the set, called directly
    DATA lt_alerts TYPE string_table.
    lt_alerts = zcl_l2_maintenance_ship=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_1 iv_hash = zcl_l3_fleet=>c_hash_1
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_grounded_ship_crew=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_2 iv_hash = zcl_l3_fleet=>c_hash_2
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_captain=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_3 iv_hash = zcl_l3_fleet=>c_hash_3
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_voyage_limit=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_4 iv_hash = zcl_l3_fleet=>c_hash_4
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_min_crew=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_5 iv_hash = zcl_l3_fleet=>c_hash_5
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_cargo_limit=>check( zcl_l3_fleet_proof=>c_check_date ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet=>c_rule_6 iv_hash = zcl_l3_fleet=>c_hash_6
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    SORT rt_rows BY rule_name model_hash alert_text.
  ENDMETHOD.

  METHOD add_expected.
    DATA ls_row TYPE ty_row.
    DATA lv_alert TYPE string.
    LOOP AT it_alerts INTO lv_alert.
      ls_row-rule_name = iv_rule.
      ls_row-model_hash = iv_hash.
      ls_row-alert_text = lv_alert.
      APPEND ls_row TO ct_rows.
    ENDLOOP.
  ENDMETHOD.

  METHOD logged.
    " the log of the proof's check date: one run's rows, or all of them
    IF iv_run IS INITIAL.
      SELECT rule_name model_hash alert_text FROM zosd_l3_alert
        INTO CORRESPONDING FIELDS OF TABLE rt_rows
        WHERE set_name = zcl_l3_fleet=>c_set
          AND check_date = zcl_l3_fleet_proof=>c_check_date.
    ELSE.
      SELECT rule_name model_hash alert_text FROM zosd_l3_alert
        INTO CORRESPONDING FIELDS OF TABLE rt_rows
        WHERE set_name = zcl_l3_fleet=>c_set
          AND check_date = zcl_l3_fleet_proof=>c_check_date
          AND run_id = iv_run.
    ENDIF.
    SORT rt_rows BY rule_name model_hash alert_text.
  ENDMETHOD.

  METHOD foreign.
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet=>c_set
        AND check_date = zcl_l3_fleet_proof=>c_check_date
        AND run_id <> iv_run.
    rv_count = sy-dbcnt.
  ENDMETHOD.

  METHOD statuses.
    " each rule's job, count and status, as collect( ) last read them
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA lv_one TYPE string.
    LOOP AT is_result-rules INTO ls_rule.
      CONCATENATE ls_rule-jobname ls_rule-jobcount ls_rule-rule ls_rule-status ';'
        INTO lv_one SEPARATED BY space.
      IF rv_text IS INITIAL.
        rv_text = lv_one.
      ELSE.
        CONCATENATE rv_text lv_one INTO rv_text SEPARATED BY space.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD assert_all.
    DATA ls_rule TYPE zcl_l3_fleet=>ty_rule.
    DATA lv_states TYPE string.
    DATA lv_msg TYPE string.
    LOOP AT is_result-rules INTO ls_rule WHERE status <> iv_status.
      lv_states = statuses( is_result ).
      CONCATENATE iv_when ':' INTO lv_msg.
      CONCATENATE lv_msg 'every rule' iv_status 'expected, got' lv_states INTO lv_msg SEPARATED BY space.
      cl_abap_unit_assert=>fail( msg = lv_msg ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
