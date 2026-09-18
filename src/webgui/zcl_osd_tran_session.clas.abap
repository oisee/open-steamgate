CLASS zcl_osd_tran_session DEFINITION PUBLIC FINAL CREATE PUBLIC.

* The state a screen sequence keeps between two HTTP requests (backlog G.3).
*
* A transaction draws a screen, somebody clicks, and the same conversation
* continues in a second request. Something has to hold what the first
* request knew, and the two candidates were weighed rather than picked:
*
*   a pinned process   the way an APC channel is pinned to one runtime for
*                      the life of its socket (tools/osd-pool.mjs)
*   a row in a table   keyed by a session id
*
* The row won, and docs/webgui.md carries the table of why. In short: the
* browser deployment is a service worker with no pool at all, so a pin would
* be a design that exists only on Node; the supervisor replaces a runtime
* after a build, and class data goes with it while a row does not; two
* browsers are two ids and cannot collide; and a process cannot expire
* anything -- it forgets when it dies -- while a TOUCHED column can.
*
* What it gave up: the state has to survive being serialised, so nothing
* can be carried across a dialog step that is not a string. A real roll area
* keeps the objects; this keeps what ZIF_OSD_TRANSACTION~ROLL_OUT wrote.
*
* PID is the work process the row was last written in, taken from
* ZOSD_SYS-PID, which is the same number the status bar prints where SAP GUI
* prints a session (backlog G.1b). Nothing routes by it. It is here so that
* a session that moved between work processes is a fact somebody can read
* rather than a thing that cannot be asked.
  PUBLIC SECTION.

* Half an hour of doing nothing, which is roughly what a dialog session gets
* on a system before rdisp/plugin_auto_logout takes it away.
    CONSTANTS gc_ttl_seconds TYPE i VALUE 1800.

    TYPES: BEGIN OF ty_session,
*            abap_true when there is a session to go on with
             found   TYPE abap_bool,
*            abap_true when there was one and it timed out. The difference
*            matters to the message and to nothing else: a swept row and a
*            made-up id look the same from outside, and both say so.
             expired TYPE abap_bool,
             sessid  TYPE string,
             tcode   TYPE string,
             state   TYPE string,
             step    TYPE i,
             pid     TYPE i,
*            the process the row was written in before this request
             was_pid TYPE i,
           END OF ty_session.

* a new session for a transaction, and a sweep of whatever nobody came back to
    CLASS-METHODS start
      IMPORTING iv_tcode          TYPE string
      RETURNING VALUE(rs_session) TYPE ty_session.

* the session an id names, if it is still there and still young enough
    CLASS-METHODS resume
      IMPORTING iv_sessid         TYPE string
      RETURNING VALUE(rs_session) TYPE ty_session.

* what this dialog step leaves for the next one. The step number is passed
* in rather than counted here, so the number the row carries is the one the
* screen printed and not one ahead of it.
    CLASS-METHODS keep
      IMPORTING iv_sessid TYPE string
                iv_state  TYPE string
                iv_step   TYPE i.

* end one, the way /n ends a transaction
    CLASS-METHODS drop
      IMPORTING iv_sessid TYPE string.

* everything older than the TTL, gone. Called by START, so a system nobody
* visits does not accumulate rows and nobody has to run a job.
    CLASS-METHODS sweep
      RETURNING VALUE(rv_removed) TYPE i.

* how many sessions are open; the system-status app and the tests read it
    CLASS-METHODS count
      RETURNING VALUE(rv_count) TYPE i.

    CLASS-METHODS now
      RETURNING VALUE(rv_now) TYPE timestamp.

  PRIVATE SECTION.

*   A 32-character session id: when it started, and randomness after that.
*
*   Not cl_system_uuid=>create_uuid_c32, which is the obvious call and is
*   unusable outside Node here: its RANDOM falls back to
*   window.crypto.randomUUID( ) when the imported crypto has no randomUUID,
*   and (a) the browser deployment is a service worker, where there is no
*   window, and (b) that branch assigns the JavaScript variable instead of
*   calling set( ) on it, so even a page would get a raw string back where
*   ABAP expects a String. Both are in the bundled preview today, read off
*   build/preview/sw.js rather than assumed
*   (ANOMALY-2026-09-18-system-uuid-window). The day that is fixed upstream
*   this becomes one line.
    CLASS-METHODS new_id
      RETURNING VALUE(rv_id) TYPE string.

* the work process the status tables were written in, or 0 where there is no
* such number (the browser deployment: a service worker is not a process)
    CLASS-METHODS work_process
      RETURNING VALUE(rv_pid) TYPE i.

ENDCLASS.


CLASS zcl_osd_tran_session IMPLEMENTATION.

  METHOD now.
    GET TIME STAMP FIELD rv_now.
  ENDMETHOD.

  METHOD new_id.
    DATA lo_random TYPE REF TO cl_abap_random.

* the timestamp first, so two ids sort the way the sessions started and a
* row can be read without joining anything
    rv_id = |{ now( ) }|.
    lo_random = cl_abap_random=>create( ).
    WHILE strlen( rv_id ) < 32.
      rv_id = rv_id && |{ lo_random->int( ) }|.
    ENDWHILE.
    rv_id = rv_id(32).
  ENDMETHOD.

  METHOD work_process.
    DATA ls_sys TYPE zosd_sys.
    SELECT SINGLE * FROM zosd_sys INTO ls_sys.
    rv_pid = ls_sys-pid.
  ENDMETHOD.

  METHOD count.
    SELECT COUNT( * ) FROM zosd_tses INTO rv_count.
  ENDMETHOD.

  METHOD sweep.
    DATA lt_row TYPE STANDARD TABLE OF zosd_tses WITH DEFAULT KEY.
    DATA ls_row TYPE zosd_tses.
    DATA lv_now TYPE timestamp.

    lv_now = now( ).
    SELECT * FROM zosd_tses INTO TABLE lt_row.
    LOOP AT lt_row INTO ls_row.
      IF cl_abap_tstmp=>subtract( tstmp1 = lv_now
                                  tstmp2 = ls_row-touched ) > gc_ttl_seconds.
        DELETE FROM zosd_tses WHERE sessid = ls_row-sessid.
        rv_removed = rv_removed + 1.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD start.
    DATA ls_row TYPE zosd_tses.
    DATA lv_now TYPE timestamp.

* whatever nobody came back to goes now rather than at some point: this is
* the only moment this system is certainly awake and doing dialog work
    sweep( ).

    lv_now = now( ).
    ls_row-sessid  = new_id( ).
    ls_row-tcode   = iv_tcode.
    ls_row-uname   = sy-uname.
    ls_row-pid     = work_process( ).
    ls_row-step    = 1.
    ls_row-created = lv_now.
    ls_row-touched = lv_now.
    INSERT zosd_tses FROM ls_row.

    rs_session-found   = abap_true.
    rs_session-sessid  = ls_row-sessid.
    rs_session-tcode   = iv_tcode.
    rs_session-step    = 1.
    rs_session-pid     = ls_row-pid.
    rs_session-was_pid = ls_row-pid.
  ENDMETHOD.

  METHOD resume.
    DATA ls_row TYPE zosd_tses.
    DATA lv_id  TYPE zosd_tses-sessid.
    DATA lv_now TYPE timestamp.

    lv_id = iv_sessid.
    IF lv_id IS INITIAL.
      RETURN.
    ENDIF.

    SELECT SINGLE * FROM zosd_tses INTO ls_row WHERE sessid = lv_id.
    IF sy-subrc <> 0.
* an id nobody has: made up, or swept. Which of the two it was is not
* knowable and is not worth pretending to know.
      RETURN.
    ENDIF.

    lv_now = now( ).
    IF cl_abap_tstmp=>subtract( tstmp1 = lv_now
                                tstmp2 = ls_row-touched ) > gc_ttl_seconds.
      DELETE FROM zosd_tses WHERE sessid = lv_id.
      rs_session-expired = abap_true.
      rs_session-sessid  = iv_sessid.
      rs_session-tcode   = ls_row-tcode.
      RETURN.
    ENDIF.

    rs_session-found   = abap_true.
    rs_session-sessid  = iv_sessid.
    rs_session-tcode   = ls_row-tcode.
    rs_session-state   = ls_row-state.
* the step this request is: one more than the last one the row saw
    rs_session-step    = ls_row-step + 1.
    rs_session-was_pid = ls_row-pid.
    rs_session-pid     = work_process( ).
  ENDMETHOD.

  METHOD keep.
    DATA ls_row TYPE zosd_tses.
    DATA lv_id  TYPE zosd_tses-sessid.

    lv_id = iv_sessid.
    SELECT SINGLE * FROM zosd_tses INTO ls_row WHERE sessid = lv_id.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    ls_row-state   = iv_state.
    ls_row-step    = iv_step.
    ls_row-touched = now( ).
* the process that answered this step, which is not necessarily the one that
* answered the last
    ls_row-pid     = work_process( ).
    UPDATE zosd_tses FROM ls_row.
  ENDMETHOD.

  METHOD drop.
    DATA lv_id TYPE zosd_tses-sessid.
    lv_id = iv_sessid.
    DELETE FROM zosd_tses WHERE sessid = lv_id.
  ENDMETHOD.

ENDCLASS.
