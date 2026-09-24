CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p07_luw FOR TESTING RAISING cx_static_check.
    METHODS seen IMPORTING iv_k TYPE csequence iv_when TYPE csequence.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD seen.
    SELECT SINGLE v FROM zosd_t_ddat WHERE k = @iv_k INTO @DATA(lv_v).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P7' iv_cb = 'SEEN' iv_txt = |{ iv_k } { iv_when }: { COND #( WHEN sy-subrc = 0 THEN |present v={ lv_v }| ELSE 'absent' ) }| ).
  ENDMETHOD.

  METHOD p07_luw.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    DELETE FROM zosd_t_ddat.
    COMMIT WORK.
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P7' iv_probe = 'P7' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'ON_START' ).
    " 1: insert, callback returns, no COMMIT WORK
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'ins' iv_n = '1' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'INS' iv_count = 1 ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-1' iv_when = 'after callback returned' ).
    " 2: insert then 2 s busy in the same callback
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'insslow' iv_n = '2' iv_ms = '2000' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'INS' iv_count = 2 ).
    WAIT UP TO '0.5' SECONDS.
    seen( iv_k = 'P7-2' iv_when = 'during callback' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'INSSLOW_END' ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-2' iv_when = 'after callback returned' ).
    " 3: insert then dump
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'insboom' iv_n = '3' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'ON_ERROR' ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-3' iv_when = 'after dump and ON_ERROR' ).
    " 4: COMMIT WORK then 1 s busy
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'commit' iv_n = '4' iv_ms = '1500' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'COMMIT_OK' iv_secs = 5 ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-4' iv_when = 'after COMMIT WORK, callback still running' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'COMMIT_END' iv_secs = 5 ).
    " 5: ROLLBACK WORK
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'rollback' iv_n = '5' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'ROLLBACK_OK' iv_secs = 5 ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-5' iv_when = 'after ROLLBACK WORK' ).
    " 6: WAIT UP TO inside the daemon
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'wait' iv_n = '6' iv_ms = '1500' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'WAIT_BEFORE' iv_secs = 5 ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'WAIT_AFTER' iv_secs = 3 ).
    WAIT UP TO '0.3' SECONDS.
    seen( iv_k = 'P7-6' iv_when = 'after WAIT UP TO, callback still running' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'ON_ERROR' iv_count = 2 iv_secs = 3 ).
    " 7: STARTING NEW TASK
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'snt' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'SNT_BEFORE' iv_secs = 5 ).
    WAIT UP TO 2 SECONDS.
    " 8: SUBMIT
    zcl_osd_t_ddrv=>send( iv_probe = 'P7' iv_inst = lv_inst iv_cmd = 'submit' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'SUBMIT_BEFORE' iv_secs = 5 ).
    WAIT UP TO 2 SECONDS.
    seen( iv_k = 'P7-1' iv_when = 'at the end' ).
    zcl_osd_t_ddrv=>stop( iv_probe = 'P7' iv_inst = lv_inst ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P7' iv_cb = 'ON_STOP' ).
    WAIT UP TO 1 SECONDS.
    seen( iv_k = 'P7-1' iv_when = 'after stop' ).
  ENDMETHOD.
ENDCLASS.
