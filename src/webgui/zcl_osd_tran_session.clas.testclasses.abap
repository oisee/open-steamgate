CLASS ltcl_session DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.

* The session store, without a server in front of it (backlog G.3).
*
* Two of these cannot be tested over HTTP at all, which is why they are here
* rather than in test/transaction.mjs: expiry needs a row that is older than
* the TTL, and the only way to have one without waiting half an hour is to
* write it. A mocha test cannot; an ABAP unit test is inside the system and
* writes the table the same way the production code does.
  PRIVATE SECTION.
    METHODS a_session_survives_the_request FOR TESTING RAISING cx_static_check.
    METHODS two_sessions_are_two_rows FOR TESTING RAISING cx_static_check.
    METHODS an_old_session_has_expired FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_id_is_not_expired FOR TESTING RAISING cx_static_check.
    METHODS the_sweep_takes_the_old_ones FOR TESTING RAISING cx_static_check.
    METHODS the_row_names_its_work_process FOR TESTING RAISING cx_static_check.

*   a row of a session that was last touched IV_AGE seconds ago
    METHODS age
      IMPORTING iv_sessid TYPE string
                iv_age    TYPE i.

    METHODS teardown.
ENDCLASS.


CLASS ltcl_session IMPLEMENTATION.

  METHOD teardown.
* the table is the system's, and a test that leaves rows in it is a test
* that makes the next one wrong
    DELETE FROM zosd_tses WHERE sessid <> ''.
  ENDMETHOD.

  METHOD age.
    DATA ls_row TYPE zosd_tses.
    DATA lv_id  TYPE zosd_tses-sessid.

    lv_id = iv_sessid.
    SELECT SINGLE * FROM zosd_tses INTO ls_row WHERE sessid = lv_id.
    cl_abap_unit_assert=>assert_subrc( ).
    ls_row-touched = cl_abap_tstmp=>subtractsecs( tstmp = zcl_osd_tran_session=>now( )
                                                  secs  = iv_age ).
    UPDATE zosd_tses FROM ls_row.
  ENDMETHOD.

  METHOD a_session_survives_the_request.
    DATA(ls_started) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    cl_abap_unit_assert=>assert_equals( act = ls_started-found exp = abap_true ).
    cl_abap_unit_assert=>assert_not_initial( ls_started-sessid ).

    zcl_osd_tran_session=>keep( iv_sessid = ls_started-sessid
                                iv_state  = '{"DRAFT":"kept"}'
                                iv_step   = 1 ).

    DATA(ls_back) = zcl_osd_tran_session=>resume( ls_started-sessid ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-found exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-tcode exp = 'ZOSD_NOTE' ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-state exp = '{"DRAFT":"kept"}' ).
*   the step the row carries is the one the screen printed, and the step this
*   request is is one more than that
    cl_abap_unit_assert=>assert_equals( act = ls_back-step exp = 2 ).
  ENDMETHOD.

  METHOD two_sessions_are_two_rows.
    DATA(ls_one) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    DATA(ls_two) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    cl_abap_unit_assert=>assert_differs( act = ls_one-sessid exp = ls_two-sessid ).

    zcl_osd_tran_session=>keep( iv_sessid = ls_one-sessid iv_state = 'one' iv_step = 1 ).
    zcl_osd_tran_session=>keep( iv_sessid = ls_two-sessid iv_state = 'two' iv_step = 1 ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_one-sessid )-state exp = 'one' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_two-sessid )-state exp = 'two' ).

*   and ending one leaves the other alone, which is what /n does
    zcl_osd_tran_session=>drop( ls_one-sessid ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_one-sessid )-found exp = abap_false ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_two-sessid )-found exp = abap_true ).
  ENDMETHOD.

  METHOD an_old_session_has_expired.
    DATA(ls_started) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    age( iv_sessid = ls_started-sessid
         iv_age    = zcl_osd_tran_session=>gc_ttl_seconds + 60 ).

    DATA(ls_back) = zcl_osd_tran_session=>resume( ls_started-sessid ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-found exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-expired exp = abap_true ).
*   it still knows what timed out, which is what the status bar prints
    cl_abap_unit_assert=>assert_equals( act = ls_back-tcode exp = 'ZOSD_NOTE' ).
*   and the row is gone rather than sitting there expiring again
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_tran_session=>count( ) exp = 0 ).

*   a session just under the TTL is still a session: the check is a timeout
*   and not a "these are old now"
    DATA(ls_young) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    age( iv_sessid = ls_young-sessid
         iv_age    = zcl_osd_tran_session=>gc_ttl_seconds - 60 ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_young-sessid )-found exp = abap_true ).
  ENDMETHOD.

  METHOD an_unknown_id_is_not_expired.
*   an id nobody has: refused, and honest about not knowing which of the two
*   it was, because a swept row and a made-up id look the same from here
    DATA(ls_back) = zcl_osd_tran_session=>resume( '00000000000000000000000000000000' ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-found exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = ls_back-expired exp = abap_false ).
  ENDMETHOD.

  METHOD the_sweep_takes_the_old_ones.
    DATA(ls_old) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    DATA(ls_new) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    age( iv_sessid = ls_old-sessid
         iv_age    = zcl_osd_tran_session=>gc_ttl_seconds + 1 ).

*   starting a transaction is the moment this system is certainly awake, so
*   that is when what nobody came back to goes
    DATA(ls_third) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_tran_session=>count( ) exp = 2 ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_new-sessid )-found exp = abap_true ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_third-sessid )-found exp = abap_true ).
  ENDMETHOD.

  METHOD the_row_names_its_work_process.
*   ZOSD_SYS-PID is the process the status tables were written in (backlog
*   G.1b), and the session row carries it so that a session which moved
*   between work processes is a fact somebody can read. Nothing routes by it,
*   which is exactly why it has to agree with the other source rather than
*   with a number typed here.
    SELECT SINGLE * FROM zosd_sys INTO @DATA(ls_sys).
    DATA(ls_started) = zcl_osd_tran_session=>start( 'ZOSD_NOTE' ).
    cl_abap_unit_assert=>assert_equals( act = ls_started-pid exp = ls_sys-pid ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_tran_session=>resume( ls_started-sessid )-was_pid exp = ls_sys-pid ).
  ENDMETHOD.

ENDCLASS.
