* The L3 runner ZCL_L3_FLEET against the rule classes it runs: seeded rows
* make six rules alert (seven alerts), mode S, every rule cut into piles of
* keys, writes exactly the union of the rules' own check answers over all
* rows, a rerun leaves the log as it was with every row on the new run, a
* rerun with one pile per rule finalises away the older run's piles, a
* plan whose pile fails stays PARTIAL and keeps the older rows, and mode P
* (one background job per rule and pile) ends with every pile DONE and the
* same log as mode S, a run started meanwhile answers BUSY, and the final
* collect releases the set's lock for the date.
* The two-stage set ZCL_L3_FLEET2 (a filter stage filling the worklist busy,
* then the checks piled over it): mode S logs exactly what the check rules
* answer over the filtered ships called directly, stage 2 plans piles over
* the worklist's keys only, mode P runs both stages on real jobs with the
* gate opening stage 2 once, and a stage 1 pile that fails keeps stage 2
* shut: the run is final with stage 2 NOT-RUN and its lock released.
* Resilience (slice 5a): a stage 1 pile that failed long ago is submitted
* again by one doctor pass on a real job, and the jobs complete the run with
* mode S's log; a rule that has written c_max_alerts alerts in a run is
* FUSED, writes nothing more, and the older run's rows of it stay.
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
    METHODS settle.
    METHODS cleanup.
    METHODS mode_s FOR TESTING.
    METHODS rerun FOR TESTING.
    METHODS rerun_fewer_piles FOR TESTING.
    METHODS mode_p FOR TESTING.
    METHODS partial_keeps_old FOR TESTING.
    METHODS stages_mode_s FOR TESTING.
    METHODS stages_mode_p FOR TESTING.
    METHODS stages_partial FOR TESTING.
    METHODS doctor_heals FOR TESTING.
    METHODS fuse_stops FOR TESTING.
    METHODS open_run
      IMPORTING iv_failed TYPE abap_bool
      RETURNING VALUE(rs_result) TYPE zcl_l3_fleet2=>ty_result.
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
    METHODS staged
      IMPORTING iv_mode TYPE c
      RETURNING VALUE(rs_result) TYPE zcl_l3_fleet2=>ty_result.
    METHODS staged_expected
      RETURNING VALUE(rt_rows) TYPE tt_row.
    METHODS staged_logged
      IMPORTING iv_run TYPE zosd_l3_alert-run_id
      RETURNING VALUE(rt_rows) TYPE tt_row.
    METHODS staged_piles
      IMPORTING iv_run TYPE zosd_l3_alert-run_id
                iv_stage TYPE i
      RETURNING VALUE(rv_count) TYPE i.
    METHODS stage_status
      IMPORTING is_result TYPE zcl_l3_fleet2=>ty_result
                iv_stage TYPE i
      RETURNING VALUE(rv_status) TYPE zosd_l3_stage-status.
    METHODS assert_cut
      IMPORTING iv_run TYPE zosd_l3_alert-run_id.
    METHODS wait_for_stages
      IMPORTING is_result TYPE zcl_l3_fleet2=>ty_result
      RETURNING VALUE(rs_result) TYPE zcl_l3_fleet2=>ty_result.
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
    " rows an interrupted run may have left under the same keys, and its
    " locks of the proof's date and a kill switch, so no method depends on
    " how the one before it ended
    delete_seed( ).
    DELETE FROM zosd_l3_run WHERE set_name = zcl_l3_fleet=>c_set
                              AND check_date = zcl_l3_fleet_proof=>c_check_date.
    DELETE FROM zosd_l3_run WHERE set_name = zcl_l3_fleet2=>c_set
                              AND check_date = zcl_l3_fleet_proof=>c_check_date.
    DELETE FROM zosd_l3_kill WHERE set_name = zcl_l3_fleet2=>c_set.
    INSERT zosd_l2_ship FROM TABLE mt_ship.
    INSERT zosd_l2_voy FROM TABLE mt_voy.
    INSERT zosd_l2_crew FROM TABLE mt_crew.
    INSERT zosd_l2_cargo FROM TABLE mt_cargo.
    COMMIT WORK.
  ENDMETHOD.

  METHOD teardown.
    " a method that failed may leave jobs of its runs open: wait for them,
    " bounded, so the deletes meet no job that writes the same rows; a delete
    " that fails all the same (a deadlock with such a job) is rolled back and
    " tried once more. Teardown never raises: an exception here would stop
    " the methods after this one on a system
    settle( ).
    TRY.
        cleanup( ).
      CATCH cx_sy_open_sql_db.
        ROLLBACK WORK.
        WAIT UP TO 1 SECONDS.
        TRY.
            cleanup( ).
          CATCH cx_sy_open_sql_db.
            ROLLBACK WORK.
        ENDTRY.
    ENDTRY.
    CLEAR mt_runs.
  ENDMETHOD.

  METHOD settle.
    " the jobs of the method's runs that are still open (a pile PLANNED or
    " RUNNING with a job neither finished nor aborted), waited for up to
    " c_wait_limit seconds
    DATA lt_piles TYPE STANDARD TABLE OF zosd_l3_pile WITH DEFAULT KEY.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA lv_run TYPE zosd_l3_alert-run_id.
    DATA lv_open TYPE i.
    DATA lv_waited TYPE i.
    DATA lv_aborted TYPE btch0000-char1.
    DATA lv_finished TYPE btch0000-char1.
    DATA lv_running TYPE btch0000-char1.
    DATA lv_ready TYPE btch0000-char1.
    DATA lv_scheduled TYPE btch0000-char1.
    DATA lv_preliminary TYPE btch0000-char1.
    DO.
      lv_open = 0.
      LOOP AT mt_runs INTO lv_run.
        SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
          WHERE run_id = lv_run
            AND job_count <> space.
        LOOP AT lt_piles INTO ls_pile WHERE status = 'PLANNED' OR status = 'RUNNING'.
          CLEAR: lv_aborted, lv_finished, lv_running, lv_ready, lv_scheduled, lv_preliminary.
          CALL FUNCTION 'SHOW_JOBSTATE'
            EXPORTING
              jobname = ls_pile-job_name
              jobcount = ls_pile-job_count
            IMPORTING
              aborted = lv_aborted
              finished = lv_finished
              preliminary = lv_preliminary
              ready = lv_ready
              running = lv_running
              scheduled = lv_scheduled
            EXCEPTIONS
              OTHERS = 1.
          IF sy-subrc = 0 AND lv_aborted <> 'X' AND lv_finished <> 'X'.
            lv_open = lv_open + 1.
          ENDIF.
        ENDLOOP.
      ENDLOOP.
      IF lv_open = 0 OR lv_waited >= c_wait_limit.
        RETURN.
      ENDIF.
      WAIT UP TO 1 SECONDS.
      lv_waited = lv_waited + 1.
    ENDDO.
  ENDMETHOD.

  METHOD cleanup.
    DATA lv_run TYPE zosd_l3_alert-run_id.
    delete_seed( ).
    LOOP AT mt_runs INTO lv_run.
      DELETE FROM zosd_l3_alert WHERE set_name = zcl_l3_fleet=>c_set AND run_id = lv_run.
      DELETE FROM zosd_l3_pile WHERE set_name = zcl_l3_fleet=>c_set AND run_id = lv_run.
    ENDLOOP.
    " the rows of the two-stage set's runs: log, plan, gates and worklists
    LOOP AT mt_runs INTO lv_run.
      DELETE FROM zosd_l3_alert WHERE set_name = zcl_l3_fleet2=>c_set AND run_id = lv_run.
      DELETE FROM zosd_l3_pile WHERE set_name = zcl_l3_fleet2=>c_set AND run_id = lv_run.
      DELETE FROM zosd_l3_stage WHERE run_id = lv_run.
      DELETE FROM zosd_l3_work WHERE run_id = lv_run.
      DELETE FROM zosd_l3_doctor WHERE run_id = lv_run.
    ENDLOOP.
    " the run locks of the proof's date, held or released
    DELETE FROM zosd_l3_run WHERE set_name = zcl_l3_fleet=>c_set
                              AND check_date = zcl_l3_fleet_proof=>c_check_date.
    DELETE FROM zosd_l3_run WHERE set_name = zcl_l3_fleet2=>c_set
                              AND check_date = zcl_l3_fleet_proof=>c_check_date.
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
    DATA ls_busy TYPE zcl_l3_fleet=>ty_result.
    DATA ls_lock TYPE zosd_l3_run.
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
    " the submitted run holds the set's lock for the date until collect( )
    " finds every pile final: a second run answers BUSY and plans nothing
    ls_busy = zcl_l3_fleet=>run( iv_date = zcl_l3_fleet_proof=>c_check_date
                                 iv_mode = zcl_l3_fleet=>c_sequential ).
    cl_abap_unit_assert=>assert_equals( act = ls_busy-status exp = 'BUSY'
      msg = 'a run while another of the same set and date is open answers BUSY' ).
    SELECT COUNT(*) FROM zosd_l3_pile WHERE set_name = zcl_l3_fleet=>c_set AND run_id = ls_busy-run_id.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'a BUSY run plans nothing' ).

    ls_par = wait_for_jobs( ls_par ).
    assert_all( is_result = ls_par iv_status = 'DONE' iv_when = 'the jobs' ).
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = zcl_l3_fleet=>c_set AND check_date = zcl_l3_fleet_proof=>c_check_date.
    cl_abap_unit_assert=>assert_equals( act = ls_lock-run_id exp = ls_par-run_id
      msg = 'the lock row names the latest run' ).
    cl_abap_unit_assert=>assert_equals( act = ls_lock-status exp = 'RELEASED'
      msg = 'collect releases the lock once every pile is final' ).
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
    DATA ls_lock TYPE zosd_l3_run.
    ls_old = run_set( zcl_l3_fleet=>c_sequential ).
    ls_new-set_name = zcl_l3_fleet=>c_set.
    ls_new-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_new-mode = zcl_l3_fleet=>c_parallel.
    ls_new-rules = zcl_l3_fleet=>rules( ).
    ls_new-run_id = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND ls_new-run_id TO mt_runs.
    " the second run holds the set's lock for the date, as run( ) takes it:
    " it is the latest run, the one collect( ) may finalise for
    ls_lock-set_name = zcl_l3_fleet=>c_set.
    ls_lock-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_lock-run_id = ls_new-run_id.
    ls_lock-status = 'HELD'.
    MODIFY zosd_l3_run FROM ls_lock.
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

  METHOD stages_mode_s.
    " two stages in one step: the filter's worklist holds each busy ship once,
    " and the log is what the check rules answer over those ships, called
    " directly; the filter writes no alert, and the run lets its lock go
    DATA lv_stage_status TYPE zosd_l3_stage-status.
    DATA ls_result TYPE zcl_l3_fleet2=>ty_result.
    DATA lt_exp TYPE tt_row.
    DATA lt_log TYPE tt_row.
    DATA lt_keys TYPE zcl_l2_ship_busy=>tt_range.
    DATA lv_count TYPE i.
    DATA lv_lines TYPE i.
    DATA ls_lock TYPE zosd_l3_run.
    lt_keys = zcl_l2_ship_busy=>keys( zcl_l3_fleet_proof=>c_check_date ).
    lv_lines = lines( lt_keys ).
    IF lv_lines < 2.
      cl_abap_unit_assert=>fail( msg = 'the seed makes at least two busy ships' ).
    ENDIF.
    lt_exp = staged_expected( ).
    ls_result = staged( zcl_l3_fleet2=>c_sequential ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'DONE' msg = 'the two-stage run ends DONE' ).
    lv_stage_status = stage_status( is_result = ls_result iv_stage = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'DONE'
      msg = 'the filter stage is DONE' ).
    lv_stage_status = stage_status( is_result = ls_result iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'DONE'
      msg = 'the check stage is DONE' ).
    SELECT COUNT(*) FROM zosd_l3_work WHERE run_id = ls_result-run_id AND worklist = 'busy'.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = lv_lines
      msg = 'the worklist holds each key keys( ) answers, once' ).
    lt_log = staged_logged( ls_result-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_log exp = lt_exp
      msg = 'the two-stage log is the check rules over the filtered ships' ).
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet2=>c_set
        AND rule_name = zcl_l3_fleet2=>c_rule_1
        AND check_date = zcl_l3_fleet_proof=>c_check_date.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'the filter stage writes no alert' ).
    assert_cut( ls_result-run_id ).
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = zcl_l3_fleet2=>c_set AND check_date = zcl_l3_fleet_proof=>c_check_date.
    cl_abap_unit_assert=>assert_equals( act = ls_lock-status exp = 'RELEASED' msg = 'mode S releases the lock' ).
  ENDMETHOD.

  METHOD stages_mode_p.
    " stage 1's piles as jobs; the job that ends stage 1 opens stage 2 through
    " the gate, once, and submits its piles; the job that ends stage 2
    " completes the run. The log equals mode S's
    DATA lv_stage_status TYPE zosd_l3_stage-status.
    DATA ls_seq TYPE zcl_l3_fleet2=>ty_result.
    DATA ls_par TYPE zcl_l3_fleet2=>ty_result.
    DATA lt_seq TYPE tt_row.
    DATA lt_par TYPE tt_row.
    DATA lv_count TYPE i.
    DATA lv_piles TYPE i.
    DATA ls_lock TYPE zosd_l3_run.
    DATA lt_jobs TYPE STANDARD TABLE OF zosd_l3_pile WITH DEFAULT KEY.
    ls_seq = staged( zcl_l3_fleet2=>c_sequential ).
    lt_seq = staged_logged( ls_seq-run_id ).
    ls_par = staged( zcl_l3_fleet2=>c_parallel ).
    cl_abap_unit_assert=>assert_equals( act = ls_par-status exp = 'SUBMITTED' msg = 'mode P submits stage 1' ).
    lv_stage_status = stage_status( is_result = ls_par iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'WAITING'
      msg = 'stage 2 waits for stage 1' ).
    lv_count = staged_piles( iv_run = ls_par-run_id iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'stage 2 is not planned while stage 1 runs' ).
    ls_par = wait_for_stages( ls_par ).
    cl_abap_unit_assert=>assert_equals( act = ls_par-status exp = 'DONE' msg = 'the jobs of both stages end the run DONE' ).
    lv_stage_status = stage_status( is_result = ls_par iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'DONE'
      msg = 'the gate opened stage 2 and its jobs ran' ).
    " opened once: one plan of stage 2, each pile with a job of its own
    assert_cut( ls_par-run_id ).
    " a job is the pair (name, count): a system's JOBCOUNT is the creation time
    " plus a counter, unique per job name only, so jobs opened in one second
    " under other names share it (A4H, 2026-10-02)
    SELECT job_name job_count FROM zosd_l3_pile INTO CORRESPONDING FIELDS OF TABLE lt_jobs
      WHERE set_name = zcl_l3_fleet2=>c_set AND run_id = ls_par-run_id AND stage_no = 2.
    DELETE lt_jobs WHERE job_count IS INITIAL.
    SORT lt_jobs BY job_name job_count.
    DELETE ADJACENT DUPLICATES FROM lt_jobs COMPARING job_name job_count.
    lv_count = lines( lt_jobs ).
    lv_piles = staged_piles( iv_run = ls_par-run_id iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = lv_piles
      msg = 'each pile of stage 2 was submitted once' ).
    lt_par = staged_logged( ls_par-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_par exp = lt_seq msg = 'the jobs wrote the log mode S wrote' ).
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = zcl_l3_fleet2=>c_set AND check_date = zcl_l3_fleet_proof=>c_check_date.
    cl_abap_unit_assert=>assert_equals( act = ls_lock-run_id exp = ls_par-run_id msg = 'the lock names the parallel run' ).
    cl_abap_unit_assert=>assert_equals( act = ls_lock-status exp = 'RELEASED' msg = 'the run released its lock' ).
  ENDMETHOD.

  METHOD stages_partial.
    " a run whose stage 1 has a pile that never ends DONE (planned, its job
    " never made): the gate keeps stage 2 shut, and collect( ) makes the run
    " final, stage 1 PARTIAL and stage 2 NOT-RUN, and releases the lock
    DATA lv_stage_status TYPE zosd_l3_stage-status.
    DATA ls_result TYPE zcl_l3_fleet2=>ty_result.
    DATA lt_piles TYPE zcl_l3_fleet2=>tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_gate TYPE zosd_l3_stage.
    DATA ls_lock TYPE zosd_l3_run.
    DATA ls_rule TYPE zcl_l3_fleet2=>ty_rule.
    DATA lv_last TYPE i.
    DATA lv_opened TYPE abap_bool.
    DATA lv_count TYPE i.
    DATA lv_status TYPE zosd_l3_stage-status.
    ls_result-set_name = zcl_l3_fleet2=>c_set.
    ls_result-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_result-mode = zcl_l3_fleet2=>c_parallel.
    ls_result-rules = zcl_l3_fleet2=>rules( ).
    ls_result-run_id = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND ls_result-run_id TO mt_runs.
    " the run as run( ) leaves it: its lock held, stage 1 open, stage 2 waiting
    ls_lock-set_name = zcl_l3_fleet2=>c_set.
    ls_lock-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_lock-run_id = ls_result-run_id.
    ls_lock-status = 'HELD'.
    MODIFY zosd_l3_run FROM ls_lock.
    ls_gate-run_id = ls_result-run_id.
    ls_gate-set_name = zcl_l3_fleet2=>c_set.
    ls_gate-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_gate-stage_no = 1.
    ls_gate-stage_name = zcl_l3_fleet2=>c_stage_1.
    ls_gate-status = 'OPEN'.
    INSERT zosd_l3_stage FROM ls_gate.
    ls_gate-stage_no = 2.
    ls_gate-stage_name = zcl_l3_fleet2=>c_stage_2.
    ls_gate-status = 'WAITING'.
    INSERT zosd_l3_stage FROM ls_gate.
    lt_piles = zcl_l3_fleet2=>plan( iv_run = ls_result-run_id
                                    iv_date = zcl_l3_fleet_proof=>c_check_date
                                    iv_stage = 1 ).
    INSERT zosd_l3_pile FROM TABLE lt_piles.
    lv_last = lines( lt_piles ).
    IF lv_last < 2.
      cl_abap_unit_assert=>fail( msg = 'stage 1 needs two piles, one to fail' ).
    ENDIF.
    LOOP AT lt_piles INTO ls_pile.
      IF sy-tabix < lv_last.
        ls_rule = zcl_l3_fleet2=>run_rule( iv_rule = ls_pile-rule_name
                                           iv_date = zcl_l3_fleet_proof=>c_check_date
                                           iv_run = ls_result-run_id
                                           iv_pile = ls_pile-pile_no ).
      ENDIF.
    ENDLOOP.
    COMMIT WORK.
    lv_opened = zcl_l3_fleet2=>advance( iv_run = ls_result-run_id
                                        iv_date = zcl_l3_fleet_proof=>c_check_date
                                        iv_stage = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lv_opened exp = abap_false
      msg = 'the gate stays shut while a pile of stage 1 is not DONE' ).
    SELECT SINGLE status FROM zosd_l3_stage INTO lv_status WHERE run_id = ls_result-run_id AND stage_no = 2.
    cl_abap_unit_assert=>assert_equals( act = lv_status exp = 'WAITING' msg = 'stage 2 is still WAITING' ).
    ls_result = zcl_l3_fleet2=>collect( ls_result ).
    COMMIT WORK.
    lv_stage_status = stage_status( is_result = ls_result iv_stage = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'PARTIAL'
      msg = 'collect finds the pile without a job FAILED and stage 1 PARTIAL' ).
    lv_stage_status = stage_status( is_result = ls_result iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_stage_status exp = 'NOT-RUN'
      msg = 'stage 2 never runs' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'PARTIAL' msg = 'the run is final, PARTIAL' ).
    lv_count = staged_piles( iv_run = ls_result-run_id iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'stage 2 was never planned' ).
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = zcl_l3_fleet2=>c_set AND check_date = zcl_l3_fleet_proof=>c_check_date.
    cl_abap_unit_assert=>assert_equals( act = ls_lock-status exp = 'RELEASED' msg = 'the final run released its lock' ).
    lv_opened = zcl_l3_fleet2=>advance( iv_run = ls_result-run_id
                                        iv_date = zcl_l3_fleet_proof=>c_check_date
                                        iv_stage = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lv_opened exp = abap_false msg = 'a late gate call opens nothing' ).
  ENDMETHOD.

  METHOD staged.
    rs_result = zcl_l3_fleet2=>run( iv_date = zcl_l3_fleet_proof=>c_check_date
                                    iv_mode = iv_mode ).
    APPEND rs_result-run_id TO mt_runs.
    COMMIT WORK.
  ENDMETHOD.

  METHOD staged_expected.
    " the check rules of stage 2, called directly over the keys the filter
    " rule answers
    DATA lt_keys TYPE zcl_l2_ship_busy=>tt_range.
    DATA lt_alerts TYPE string_table.
    lt_keys = zcl_l2_ship_busy=>keys( zcl_l3_fleet_proof=>c_check_date ).
    lt_alerts = zcl_l2_maintenance_ship=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_2 iv_hash = zcl_l3_fleet2=>c_hash_2
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_grounded_ship_crew=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_3 iv_hash = zcl_l3_fleet2=>c_hash_3
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_captain=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_4 iv_hash = zcl_l3_fleet2=>c_hash_4
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_voyage_limit=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_5 iv_hash = zcl_l3_fleet2=>c_hash_5
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_min_crew=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_6 iv_hash = zcl_l3_fleet2=>c_hash_6
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    lt_alerts = zcl_l2_ship_cargo_limit=>check( iv_date = zcl_l3_fleet_proof=>c_check_date it_range = lt_keys ).
    add_expected( EXPORTING iv_rule = zcl_l3_fleet2=>c_rule_7 iv_hash = zcl_l3_fleet2=>c_hash_7
                            it_alerts = lt_alerts CHANGING ct_rows = rt_rows ).
    SORT rt_rows BY rule_name model_hash alert_text.
  ENDMETHOD.

  METHOD staged_logged.
    SELECT rule_name model_hash alert_text FROM zosd_l3_alert
      INTO CORRESPONDING FIELDS OF TABLE rt_rows
      WHERE set_name = zcl_l3_fleet2=>c_set
        AND check_date = zcl_l3_fleet_proof=>c_check_date
        AND run_id = iv_run.
    SORT rt_rows BY rule_name model_hash alert_text.
  ENDMETHOD.

  METHOD staged_piles.
    SELECT COUNT(*) FROM zosd_l3_pile
      WHERE set_name = zcl_l3_fleet2=>c_set
        AND run_id = iv_run
        AND stage_no = iv_stage.
    rv_count = sy-dbcnt.
  ENDMETHOD.

  METHOD stage_status.
    DATA ls_stage TYPE zcl_l3_fleet2=>ty_stage.
    READ TABLE is_result-stages INTO ls_stage WITH KEY stage_no = iv_stage.
    rv_status = ls_stage-status.
  ENDMETHOD.

  METHOD assert_cut.
    " the filter cuts work: every check rule of stage 2 has one pile per two
    " keys of the worklist, fewer than two keys per pile of every ship would give
    DATA lv_keys TYPE i.
    DATA lv_ships TYPE i.
    DATA lv_per_rule TYPE i.
    DATA lv_piles TYPE i.
    SELECT COUNT(*) FROM zosd_l3_work WHERE run_id = iv_run AND worklist = 'busy'.
    lv_keys = sy-dbcnt.
    SELECT COUNT(*) FROM zosd_l2_ship.
    lv_ships = sy-dbcnt.
    IF lv_keys >= lv_ships.
      cl_abap_unit_assert=>fail( msg = 'the filter keeps fewer ships than the fleet has' ).
    ENDIF.
    lv_per_rule = ( lv_keys + 1 ) DIV 2.
    lv_per_rule = lv_per_rule * 6.
    lv_piles = staged_piles( iv_run = iv_run iv_stage = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lv_piles exp = lv_per_rule
      msg = 'stage 2 has one pile per two worklist keys for each of its six rules' ).
  ENDMETHOD.

  METHOD wait_for_stages.
    " collect( ) is one read; the waiting is the caller's, bounded
    DATA lv_waited TYPE i.
    DATA lv_limit TYPE string.
    DATA lv_msg TYPE string.
    DATA lv_one TYPE string.
    DATA lv_two TYPE string.
    DO.
      rs_result = zcl_l3_fleet2=>collect( is_result ).
      COMMIT WORK.
      IF rs_result-status = 'DONE' OR rs_result-status = 'PARTIAL'.
        RETURN.
      ENDIF.
      IF lv_waited >= c_wait_limit.
        lv_limit = c_wait_limit.
        CONDENSE lv_limit.
        lv_one = stage_status( is_result = rs_result iv_stage = 1 ).
        lv_two = stage_status( is_result = rs_result iv_stage = 2 ).
        CONCATENATE 'the stages did not end within' lv_limit 'seconds: stage 1' lv_one 'stage 2' lv_two
          INTO lv_msg SEPARATED BY space.
        cl_abap_unit_assert=>fail( msg = lv_msg ).
        RETURN.
      ENDIF.
      WAIT UP TO 1 SECONDS.
      lv_waited = lv_waited + 1.
    ENDDO.
  ENDMETHOD.

  METHOD open_run.
    " a run in jobs as run( ) leaves it once stage 1 has run: its lock held
    " (since long ago), stage 1 open, stage 2 waiting. Every pile of stage 1
    " ran but, with iv_failed, the last, which is FAILED long ago after its
    " first attempt, as a job that aborted leaves it once a doctor looked
    DATA lt_piles TYPE zcl_l3_fleet2=>tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_gate TYPE zosd_l3_stage.
    DATA ls_lock TYPE zosd_l3_run.
    DATA ls_rule TYPE zcl_l3_fleet2=>ty_rule.
    DATA lv_last TYPE i.
    rs_result-set_name = zcl_l3_fleet2=>c_set.
    rs_result-check_date = zcl_l3_fleet_proof=>c_check_date.
    rs_result-mode = zcl_l3_fleet2=>c_parallel.
    rs_result-rules = zcl_l3_fleet2=>rules( ).
    rs_result-run_id = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND rs_result-run_id TO mt_runs.
    ls_lock-set_name = zcl_l3_fleet2=>c_set.
    ls_lock-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_lock-run_id = rs_result-run_id.
    ls_lock-status = 'HELD'.
    ls_lock-started = '20000101000000'.
    MODIFY zosd_l3_run FROM ls_lock.
    ls_gate-run_id = rs_result-run_id.
    ls_gate-set_name = zcl_l3_fleet2=>c_set.
    ls_gate-check_date = zcl_l3_fleet_proof=>c_check_date.
    ls_gate-stage_no = 1.
    ls_gate-stage_name = zcl_l3_fleet2=>c_stage_1.
    ls_gate-status = 'OPEN'.
    ls_gate-opened = '20000101000000'.
    INSERT zosd_l3_stage FROM ls_gate.
    ls_gate-stage_no = 2.
    ls_gate-stage_name = zcl_l3_fleet2=>c_stage_2.
    ls_gate-status = 'WAITING'.
    CLEAR ls_gate-opened.
    INSERT zosd_l3_stage FROM ls_gate.
    lt_piles = zcl_l3_fleet2=>plan( iv_run = rs_result-run_id
                                    iv_date = zcl_l3_fleet_proof=>c_check_date
                                    iv_stage = 1 ).
    INSERT zosd_l3_pile FROM TABLE lt_piles.
    lv_last = lines( lt_piles ).
    IF lv_last < 2.
      cl_abap_unit_assert=>fail( msg = 'stage 1 needs two piles, one to fail' ).
    ENDIF.
    LOOP AT lt_piles INTO ls_pile.
      IF sy-tabix < lv_last OR iv_failed = abap_false.
        ls_rule = zcl_l3_fleet2=>run_rule( iv_rule = ls_pile-rule_name
                                           iv_date = zcl_l3_fleet_proof=>c_check_date
                                           iv_run = rs_result-run_id
                                           iv_pile = ls_pile-pile_no ).
      ELSE.
        ls_pile-status = 'FAILED'.
        ls_pile-attempt = 1.
        ls_pile-reason = 'JOB-ENDED'.
        ls_pile-ended = '20000101000000'.
        MODIFY zosd_l3_pile FROM ls_pile.
      ENDIF.
    ENDLOOP.
    COMMIT WORK.
  ENDMETHOD.

  METHOD doctor_heals.
    " one doctor pass submits the failed pile of stage 1 again, once, on a
    " real job (its backoff passed long ago, its budget is not spent); that
    " job ends stage 1 and opens stage 2 through the gate, and the jobs of
    " stage 2 complete the run: the log equals mode S's
    DATA ls_seq TYPE zcl_l3_fleet2=>ty_result.
    DATA ls_result TYPE zcl_l3_fleet2=>ty_result.
    DATA lt_seq TYPE tt_row.
    DATA lt_par TYPE tt_row.
    DATA lt_report TYPE zcl_l3_fleet2=>tt_doctor.
    DATA ls_report TYPE zcl_l3_fleet2=>ty_doctor.
    DATA lt_piles TYPE zcl_l3_fleet2=>tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_lock TYPE zosd_l3_run.
    DATA lv_count TYPE i.
    ls_seq = staged( zcl_l3_fleet2=>c_sequential ).
    lt_seq = staged_logged( ls_seq-run_id ).
    ls_result = open_run( abap_true ).
    lt_report = zcl_l3_fleet2=>doctor( ).
    COMMIT WORK.
    LOOP AT lt_report INTO ls_report WHERE run_id = ls_result-run_id AND doc_action = 'RESUBMIT'.
      lv_count = lv_count + 1.
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 msg = 'the doctor submits the failed pile again, once' ).
    ls_result = wait_for_stages( ls_result ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-status exp = 'DONE' msg = 'the healed run ends DONE' ).
    SELECT * FROM zosd_l3_pile INTO TABLE lt_piles
      WHERE set_name = zcl_l3_fleet2=>c_set AND run_id = ls_result-run_id AND stage_no = 1 AND attempt = 2.
    lv_count = lines( lt_piles ).
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 msg = 'one pile had a second attempt' ).
    READ TABLE lt_piles INTO ls_pile INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = ls_pile-status exp = 'DONE' msg = 'its second attempt is DONE' ).
    lt_par = staged_logged( ls_result-run_id ).
    cl_abap_unit_assert=>assert_equals( act = lt_par exp = lt_seq msg = 'the healed run wrote the log mode S wrote' ).
    SELECT SINGLE * FROM zosd_l3_run INTO ls_lock
      WHERE set_name = zcl_l3_fleet2=>c_set AND check_date = zcl_l3_fleet_proof=>c_check_date.
    cl_abap_unit_assert=>assert_equals( act = ls_lock-status exp = 'RELEASED' msg = 'the healed run released its lock' ).
    SELECT COUNT(*) FROM zosd_l3_doctor WHERE run_id = ls_result-run_id AND doc_action = 'RESUBMIT'.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 msg = 'the audit holds the resubmit' ).
  ENDMETHOD.

  METHOD fuse_stops.
    " stage 2 of a run in which the voyage rule has already written
    " c_max_alerts alerts (a DONE pile of it saying so): each of its own piles
    " with an alert is FUSED and writes nothing, so the older run's rows of
    " the rule stay; collect( ) reports the rule FUSED and finalises nothing
    " of it
    DATA ls_seq TYPE zcl_l3_fleet2=>ty_result.
    DATA ls_result TYPE zcl_l3_fleet2=>ty_result.
    DATA lt_piles TYPE zcl_l3_fleet2=>tt_pile.
    DATA ls_pile TYPE zosd_l3_pile.
    DATA ls_rule TYPE zcl_l3_fleet2=>ty_rule.
    DATA lv_older TYPE i.
    DATA lv_count TYPE i.
    DATA lv_fused TYPE i.
    ls_seq = staged( zcl_l3_fleet2=>c_sequential ).
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet2=>c_set AND rule_name = zcl_l3_fleet2=>c_rule_5
        AND check_date = zcl_l3_fleet_proof=>c_check_date AND run_id = ls_seq-run_id.
    lv_older = sy-dbcnt.
    IF lv_older < 1.
      cl_abap_unit_assert=>fail( msg = 'the seed makes the voyage rule alert' ).
    ENDIF.
    ls_result = open_run( abap_false ).
    UPDATE zosd_l3_stage SET status = 'DONE' WHERE run_id = ls_result-run_id AND stage_no = 1.
    UPDATE zosd_l3_stage SET status = 'OPEN' WHERE run_id = ls_result-run_id AND stage_no = 2.
    lt_piles = zcl_l3_fleet2=>plan( iv_run = ls_result-run_id
                                    iv_date = zcl_l3_fleet_proof=>c_check_date
                                    iv_stage = 2 ).
    INSERT zosd_l3_pile FROM TABLE lt_piles.
    " what the rule's other piles of this run have written: the limit
    ls_pile-set_name = zcl_l3_fleet2=>c_set.
    ls_pile-run_id = ls_result-run_id.
    ls_pile-rule_name = zcl_l3_fleet2=>c_rule_5.
    ls_pile-pile_no = 9999.
    ls_pile-stage_no = 2.
    ls_pile-status = 'DONE'.
    ls_pile-alerts = zcl_l3_fleet2=>c_max_alerts.
    INSERT zosd_l3_pile FROM ls_pile.
    LOOP AT lt_piles INTO ls_pile WHERE rule_name = zcl_l3_fleet2=>c_rule_5.
      ls_rule = zcl_l3_fleet2=>run_rule( iv_rule = ls_pile-rule_name
                                         iv_date = zcl_l3_fleet_proof=>c_check_date
                                         iv_run = ls_result-run_id
                                         iv_pile = ls_pile-pile_no ).
      IF ls_rule-status = 'FUSED'.
        lv_fused = lv_fused + 1.
      ENDIF.
    ENDLOOP.
    COMMIT WORK.
    IF lv_fused < 1.
      cl_abap_unit_assert=>fail( msg = 'a pile of the voyage rule past c_max_alerts is FUSED' ).
    ENDIF.
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet2=>c_set AND rule_name = zcl_l3_fleet2=>c_rule_5
        AND check_date = zcl_l3_fleet_proof=>c_check_date AND run_id = ls_result-run_id.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'the fused rule wrote nothing past the limit' ).
    ls_result = zcl_l3_fleet2=>collect( ls_result ).
    COMMIT WORK.
    READ TABLE ls_result-rules INTO ls_rule WITH KEY rule = zcl_l3_fleet2=>c_rule_5.
    cl_abap_unit_assert=>assert_equals( act = ls_rule-status exp = 'FUSED' msg = 'collect reports the rule FUSED' ).
    SELECT COUNT(*) FROM zosd_l3_alert
      WHERE set_name = zcl_l3_fleet2=>c_set AND rule_name = zcl_l3_fleet2=>c_rule_5
        AND check_date = zcl_l3_fleet_proof=>c_check_date AND run_id = ls_seq-run_id.
    lv_count = sy-dbcnt.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = lv_older msg = 'the older run keeps its rows of the fused rule' ).
  ENDMETHOD.

ENDCLASS.
