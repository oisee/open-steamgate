CLASS zcl_osd_t_dmn DEFINITION
  PUBLIC
  INHERITING FROM cl_abap_daemon_ext_base
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
    INTERFACES if_amc_message_receiver_pcp.

    CONSTANTS co_version TYPE string VALUE 'V1'.
    CLASS-DATA gv_static TYPE string.
    CLASS-DATA gv_ticks TYPE i.

    CLASS-METHODS log
      IMPORTING iv_probe TYPE csequence
                iv_cb    TYPE csequence
                iv_inst  TYPE csequence OPTIONAL
                iv_txt   TYPE csequence OPTIONAL.
    CLASS-METHODS now RETURNING VALUE(rv) TYPE timestampl.
    CLASS-METHODS ms_since IMPORTING iv_from TYPE timestampl RETURNING VALUE(rv) TYPE string.

    METHODS if_abap_daemon_extension~on_accept REDEFINITION.
    METHODS if_abap_daemon_extension~on_start REDEFINITION.
    METHODS if_abap_daemon_extension~on_message REDEFINITION.
    METHODS if_abap_daemon_extension~on_stop REDEFINITION.
    METHODS if_abap_daemon_extension~on_error REDEFINITION.
    METHODS if_abap_daemon_extension~on_restart REDEFINITION.
    METHODS if_abap_daemon_extension~on_before_restart_by_system REDEFINITION.
    METHODS if_abap_daemon_extension~on_server_shutdown REDEFINITION.
    METHODS if_abap_daemon_extension~on_system_shutdown REDEFINITION.

  PRIVATE SECTION.
    DATA mv_probe TYPE string.
    DATA mv_inst TYPE string.
    DATA mv_armed TYPE timestampl.
    DATA mt_delays TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    DATA mv_idx TYPE i.
    DATA mv_attr TYPE string.
    DATA mt_keep TYPE STANDARD TABLE OF REF TO object WITH EMPTY KEY.
    TYPES: BEGIN OF ty_amc, tag TYPE string, count TYPE i, last TYPE i, gaps TYPE i, END OF ty_amc.
    DATA mt_amc TYPE STANDARD TABLE OF ty_amc WITH EMPTY KEY.
    DATA mv_last_tag TYPE string.
    DATA mv_switches TYPE i.
    DATA mt_consumers TYPE STANDARD TABLE OF REF TO if_amc_message_consumer WITH EMPTY KEY.
    METHODS amc_send IMPORTING iv_ch TYPE string iv_tag TYPE string iv_n TYPE i RAISING cx_static_check.
    METHODS init IMPORTING io_ctx TYPE REF TO if_abap_daemon_context.
    METHODS busy IMPORTING iv_ms TYPE i.
    METHODS arm_next.
    METHODS boom.
    METHODS do_start IMPORTING i_context TYPE REF TO if_abap_daemon_context RAISING cx_static_check.
    METHODS do_restart IMPORTING i_context TYPE REF TO if_abap_daemon_context RAISING cx_static_check.
    METHODS do_message IMPORTING i_message TYPE REF TO if_ac_message_type_pcp i_context TYPE REF TO if_abap_daemon_context RAISING cx_static_check.
ENDCLASS.



CLASS zcl_osd_t_dmn IMPLEMENTATION.

  METHOD now.
    GET TIME STAMP FIELD rv.
  ENDMETHOD.

  METHOD ms_since.
    DATA lv_s TYPE p LENGTH 16 DECIMALS 7.
    DATA lv_now TYPE timestampl.
    DATA lv_from TYPE timestampl.
    GET TIME STAMP FIELD lv_now.
    lv_from = iv_from.
    lv_s = cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = lv_from ).
    DATA(lv_ms) = CONV decfloat34( lv_s * 1000 ).
    rv = |{ lv_ms DECIMALS = 3 }|.
  ENDMETHOD.

  METHOD log.
    DATA ls TYPE zosd_t_dlog.
    TRY.
        ls-logid = cl_system_uuid=>create_uuid_x16_static( ).
      CATCH cx_uuid_error.
    ENDTRY.
    ls-mandt = sy-mandt.
    ls-probe = iv_probe.
    GET TIME STAMP FIELD ls-ts.
    ls-cb = iv_cb.
    ls-inst = iv_inst.
    ls-uname = sy-uname.
    ls-clnt = sy-mandt.
    ls-txt = iv_txt.
    INSERT zosd_t_dlog CONNECTION r/3*osdlog FROM ls.
    COMMIT CONNECTION r/3*osdlog.
  ENDMETHOD.

  METHOD init.
    IF io_ctx IS NOT BOUND.
      RETURN.
    ENDIF.
    TRY.
        mv_inst = io_ctx->get_instance_id( ).
        DATA(lo_p) = io_ctx->get_start_parameter( ).
        IF lo_p IS BOUND.
          mv_probe = lo_p->get_field( 'probe' ).
        ENDIF.
      CATCH cx_root INTO DATA(lx).
        log( iv_probe = 'INIT' iv_cb = 'INIT_ERR' iv_txt = lx->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD busy.
    DATA: t0 TYPE i, t1 TYPE i.
    GET RUN TIME FIELD t0.
    DO.
      GET RUN TIME FIELD t1.
      IF t1 - t0 >= iv_ms * 1000.
        EXIT.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD boom.
    DATA lv_z TYPE i.
    DATA lv_r TYPE i.
    lv_r = 1 / lv_z.
    log( iv_probe = mv_probe iv_cb = 'AFTER_BOOM' iv_txt = |{ lv_r }| ).
  ENDMETHOD.

  METHOD arm_next.
    mv_idx = mv_idx + 1.
    READ TABLE mt_delays INDEX mv_idx INTO DATA(lv_ms).
    IF sy-subrc <> 0.
      log( iv_probe = mv_probe iv_cb = 'TDONE' iv_inst = mv_inst ).
      RETURN.
    ENDIF.
    mv_armed = now( ).
    TRY.
        cl_abap_timer_manager=>get_timer_manager( )->start_timer( i_timer_handler = me i_timeout = lv_ms ).
      CATCH cx_abap_timer_error INTO DATA(lx).
        log( iv_probe = mv_probe iv_cb = 'TARM_ERR' iv_txt = lx->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD if_abap_timer_handler~on_timeout.
    READ TABLE mt_delays INDEX mv_idx INTO DATA(lv_ms).
    log( iv_probe = mv_probe iv_cb = 'TIMEOUT' iv_inst = mv_inst
         iv_txt = |req={ lv_ms } act={ ms_since( mv_armed ) }| ).
    IF mv_attr = 'TICKBOOM'.
      boom( ).
    ENDIF.
    arm_next( ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_accept.
    DATA lv_txt TYPE string.
    TRY.
        DATA(ls_ci) = i_context_base->get_start_caller_info( ).
        lv_txt = |client={ ls_ci-client } user={ ls_ci-user } prog={ ls_ci-program } name={ ls_ci-name } prio={ ls_ci-priority } dest={ ls_ci-used_dest }|.
        DATA(lo_p) = i_context_base->get_start_parameter( ).
        IF lo_p IS BOUND.
          mv_probe = lo_p->get_field( 'probe' ).
        ENDIF.
      CATCH cx_root INTO DATA(lx).
        lv_txt = lx->get_text( ).
    ENDTRY.
    log( iv_probe = mv_probe iv_cb = 'ON_ACCEPT' iv_txt = lv_txt ).
    IF mv_probe = 'P5R'.
      e_setup_mode = co_setup_mode-reject.
    ELSE.
      e_setup_mode = co_setup_mode-accept.
    ENDIF.
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_start.
    TRY.
        do_start( i_context ).
      CATCH cx_static_check INTO DATA(lx_w).
        log( iv_probe = mv_probe iv_cb = 'CAUGHT_ON_START' iv_inst = mv_inst iv_txt = lx_w->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD do_start.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_START' iv_inst = mv_inst
         iv_txt = |ver={ co_version } static=[{ gv_static }]| ).
    gv_static = |DAEMON-{ mv_probe }|.
    DATA(lo_p) = i_context->get_start_parameter( ).
    IF lo_p->get_field( 'startboom' ) = 'X'.
      boom( ).
    ENDIF.
    IF lo_p->get_field( 'tickboom' ) = 'X'.
      mv_attr = 'TICKBOOM'.
      mt_delays = VALUE #( ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ).
      mv_idx = 0.
      arm_next( ).
    ENDIF.
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_restart.
    TRY.
        do_restart( i_context ).
      CATCH cx_static_check INTO DATA(lx_w).
        log( iv_probe = mv_probe iv_cb = 'CAUGHT_ON_RESTART' iv_inst = mv_inst iv_txt = lx_w->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD do_restart.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_RESTART' iv_inst = mv_inst
         iv_txt = |ver={ co_version } static=[{ gv_static }] attr=[{ mv_attr }]| ).
    DATA(lo_p) = i_context->get_start_parameter( ).
    IF lo_p->get_field( 'tickboom' ) = 'X'.
      mv_attr = 'TICKBOOM'.
      mt_delays = VALUE #( ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ( 50 ) ).
      mv_idx = 0.
      arm_next( ).
    ENDIF.
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_error.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_ERROR' iv_inst = mv_inst
         iv_txt = |code={ i_code } ver={ co_version } static=[{ gv_static }] reason={ i_reason }| ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_before_restart_by_system.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_BEFORE_RESTART' iv_inst = mv_inst
         iv_txt = |code={ i_code } ver={ co_version } static=[{ gv_static }] attr=[{ mv_attr }]| ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_server_shutdown.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_SERVER_SHUTDOWN' iv_inst = mv_inst ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_system_shutdown.
    init( i_context ).
    log( iv_probe = mv_probe iv_cb = 'ON_SYSTEM_SHUTDOWN' iv_inst = mv_inst ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_stop.
    DATA lv_txt TYPE string.
    init( i_context ).
    IF i_message IS BOUND.
      TRY.
          lv_txt = |text={ i_message->get_text( ) } why={ i_message->get_field( 'why' ) }|.
        CATCH cx_root INTO DATA(lx).
          lv_txt = lx->get_text( ).
      ENDTRY.
    ELSE.
      lv_txt = 'no message'.
    ENDIF.
    log( iv_probe = mv_probe iv_cb = 'ON_STOP' iv_inst = mv_inst iv_txt = lv_txt ).
  ENDMETHOD.

  METHOD if_abap_daemon_extension~on_message.
    TRY.
        do_message( i_message = i_message i_context = i_context ).
      CATCH cx_static_check INTO DATA(lx_w).
        log( iv_probe = mv_probe iv_cb = 'CAUGHT_ON_MESSAGE' iv_inst = mv_inst iv_txt = lx_w->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD if_amc_message_receiver_pcp~receive.
    DATA lv_seq TYPE i.
    DATA lv_total TYPE i.
    DATA lv_gap TYPE abap_bool.
    TRY.
        DATA(lv_tag) = i_message->get_field( 'tag' ).
        lv_seq = i_message->get_field( 'seq' ).
        lv_total = i_message->get_field( 'total' ).
        DATA(lv_ch) = i_message->get_field( 'ch' ).
      CATCH cx_root INTO DATA(lx).
        log( iv_probe = mv_probe iv_cb = 'AMC_RX_ERR' iv_txt = lx->get_text( ) ).
        RETURN.
    ENDTRY.
    READ TABLE mt_amc ASSIGNING FIELD-SYMBOL(<ls>) WITH KEY tag = lv_tag.
    IF sy-subrc <> 0.
      APPEND VALUE #( tag = lv_tag ) TO mt_amc ASSIGNING <ls>.
    ENDIF.
    <ls>-count = <ls>-count + 1.
    IF lv_seq <> <ls>-last + 1.
      <ls>-gaps = <ls>-gaps + 1.
      lv_gap = abap_true.
    ENDIF.
    <ls>-last = lv_seq.
    IF mv_last_tag IS NOT INITIAL AND mv_last_tag <> lv_tag.
      mv_switches = mv_switches + 1.
    ENDIF.
    mv_last_tag = lv_tag.
    IF lv_seq = 1 OR lv_seq = lv_total OR lv_gap = abap_true.
      log( iv_probe = mv_probe
           iv_cb = COND #( WHEN lv_seq = lv_total THEN 'AMC_RX_END' WHEN lv_gap = abap_true THEN 'AMC_RX_GAP' ELSE 'AMC_RX_FIRST' )
           iv_inst = lv_tag
           iv_txt = |ch={ lv_ch } tag={ lv_tag } seq={ lv_seq }/{ lv_total } count={ <ls>-count } gaps={ <ls>-gaps } switches={ mv_switches } | &&
                    |same_client={ xsdbool( i_context->get_producer_client( ) = sy-mandt ) } same_user={ xsdbool( i_context->get_producer_username( ) = sy-uname ) }| ).
    ENDIF.
  ENDMETHOD.

  METHOD amc_send.
    DATA lo_p TYPE REF TO if_amc_message_producer_pcp.
    lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'ZOSD_T_AMC' i_channel_id = CONV #( iv_ch ) ).
    DO iv_n TIMES.
      DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
      lo_m->set_field( i_name = 'tag' i_value = iv_tag ).
      lo_m->set_field( i_name = 'seq' i_value = |{ sy-index }| ).
      lo_m->set_field( i_name = 'total' i_value = |{ iv_n }| ).
      lo_m->set_field( i_name = 'ch' i_value = iv_ch ).
      lo_p->send( lo_m ).
    ENDDO.
  ENDMETHOD.

  METHOD do_message.
    DATA lv_cmd TYPE string.
    DATA lv_n TYPE string.
    DATA lv_ms TYPE i.
    DATA ls_dat TYPE zosd_t_ddat.
    IF mv_inst IS INITIAL.
      init( i_context ).
    ENDIF.
    TRY.
        lv_cmd = i_message->get_field( 'cmd' ).
        lv_n = i_message->get_field( 'n' ).
        DATA(lv_msf) = i_message->get_field( 'ms' ).
      CATCH cx_ac_message_type_pcp_error INTO DATA(lxp).
        log( iv_probe = mv_probe iv_cb = 'MSG_ERR' iv_txt = lxp->get_text( ) ).
        RETURN.
    ENDTRY.

    CASE lv_cmd.
      WHEN 'busy'.
        log( iv_probe = mv_probe iv_cb = 'ENTER' iv_inst = mv_inst iv_txt = lv_n ).
        lv_ms = lv_msf.
        busy( lv_ms ).
        log( iv_probe = mv_probe iv_cb = 'EXIT' iv_inst = mv_inst iv_txt = lv_n ).

      WHEN 'boom'.
        log( iv_probe = mv_probe iv_cb = 'BOOM' iv_inst = mv_inst iv_txt = lv_n ).
        boom( ).

      WHEN 'ver'.
        log( iv_probe = mv_probe iv_cb = 'VER' iv_inst = mv_inst
             iv_txt = |n={ lv_n } ver={ co_version } attr=[{ mv_attr }] static=[{ gv_static }]| ).
        mv_attr = |set-by-{ lv_n }|.

      WHEN 'static'.
        log( iv_probe = mv_probe iv_cb = 'STATIC' iv_inst = mv_inst iv_txt = |static=[{ gv_static }]| ).

      WHEN 'timers'.
        DATA lt_parts TYPE STANDARD TABLE OF string WITH EMPTY KEY.
        SPLIT lv_msf AT ',' INTO TABLE lt_parts.
        DATA(lv_rep) = CONV i( i_message->get_field( 'rep' ) ).
        CLEAR mt_delays.
        LOOP AT lt_parts INTO DATA(lv_part).
          DO lv_rep TIMES.
            APPEND CONV i( lv_part ) TO mt_delays.
          ENDDO.
        ENDLOOP.
        mv_idx = 0.
        log( iv_probe = mv_probe iv_cb = 'TSTART' iv_inst = mv_inst iv_txt = |{ lines( mt_delays ) }| ).
        arm_next( ).

      WHEN 'tbad'.
        DATA(lo_tm) = cl_abap_timer_manager=>get_timer_manager( ).
        DATA lo_t TYPE REF TO zcl_osd_t_tick.
        " zero
        lo_t = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'zero' ).
        APPEND lo_t TO mt_keep.
        TRY.
            lo_tm->start_timer( i_timer_handler = lo_t i_timeout = 0 ).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = 'zero accepted' ).
          CATCH cx_abap_timer_error INTO DATA(lx0).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |zero: { lx0->get_text( ) }| ).
        ENDTRY.
        " negative
        lo_t = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'neg' ).
        APPEND lo_t TO mt_keep.
        TRY.
            lo_tm->start_timer( i_timer_handler = lo_t i_timeout = -5 ).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = 'neg accepted' ).
          CATCH cx_abap_timer_error INTO DATA(lx1).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |neg: { lx1->get_text( ) }| ).
        ENDTRY.
        " same handler twice
        lo_t = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'twice' ).
        APPEND lo_t TO mt_keep.
        TRY.
            lo_tm->start_timer( i_timer_handler = lo_t i_timeout = 300 ).
            lo_tm->start_timer( i_timer_handler = lo_t i_timeout = 100 ).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = 'twice accepted' ).
          CATCH cx_abap_timer_error INTO DATA(lx2).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |twice: { lx2->get_text( ) }| ).
        ENDTRY.
        " stop an unarmed handler
        lo_t = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'unarmed' ).
        TRY.
            lo_tm->stop_timer( lo_t ).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = 'stop unarmed accepted' ).
          CATCH cx_abap_timer_error INTO DATA(lx3).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |stop unarmed: { lx3->get_text( ) }| ).
        ENDTRY.
        " stop an armed handler: must not fire
        lo_t = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'stopped' ).
        APPEND lo_t TO mt_keep.
        TRY.
            lo_tm->start_timer( i_timer_handler = lo_t i_timeout = 200 ).
            lo_tm->stop_timer( lo_t ).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = 'stop armed ok' ).
          CATCH cx_abap_timer_error INTO DATA(lx4).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |stop armed: { lx4->get_text( ) }| ).
        ENDTRY.
        " a handler not held by anybody (garbage?)
        TRY.
            lo_tm->start_timer( i_timer_handler = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'unheld' ) i_timeout = 100 ).
          CATCH cx_abap_timer_error INTO DATA(lx5).
            log( iv_probe = mv_probe iv_cb = 'TBAD' iv_txt = |unheld: { lx5->get_text( ) }| ).
        ENDTRY.
        log( iv_probe = mv_probe iv_cb = 'TBADDONE' ).

      WHEN 'tmany'.
        DATA(lv_cnt) = CONV i( lv_n ).
        zcl_osd_t_tick=>gv_fired = 0.
        zcl_osd_t_tick=>gv_expect = lv_cnt.
        DATA(lo_tm2) = cl_abap_timer_manager=>get_timer_manager( ).
        DATA(lv_ok) = 0.
        DO lv_cnt TIMES.
          DATA(lo_t2) = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'many' ).
          APPEND lo_t2 TO mt_keep.
          TRY.
              lo_tm2->start_timer( i_timer_handler = lo_t2 i_timeout = CONV i( lv_msf ) ).
              lv_ok = lv_ok + 1.
            CATCH cx_abap_timer_error INTO DATA(lx6).
              log( iv_probe = mv_probe iv_cb = 'TMANY_ERR' iv_txt = |at { sy-index }: { lx6->get_text( ) }| ).
              EXIT.
          ENDTRY.
        ENDDO.
        zcl_osd_t_tick=>gv_armed_at = now( ).
        log( iv_probe = mv_probe iv_cb = 'TMANY_ARMED' iv_txt = |{ lv_ok }| ).

      WHEN 'tbusy'.
        DATA(lo_t3) = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = 'during-busy' ).
        APPEND lo_t3 TO mt_keep.
        lo_t3->mv_armed = now( ).
        cl_abap_timer_manager=>get_timer_manager( )->start_timer( i_timer_handler = lo_t3 i_timeout = 10 ).
        log( iv_probe = mv_probe iv_cb = 'BUSYSTART' ).
        busy( 500 ).
        log( iv_probe = mv_probe iv_cb = 'BUSYEND' ).

      WHEN 'tlong'.
        DATA(lo_t4) = NEW zcl_osd_t_tick( iv_probe = mv_probe iv_label = |long-{ lv_n }| ).
        APPEND lo_t4 TO mt_keep.
        lo_t4->mv_armed = now( ).
        lv_ms = lv_msf.
        cl_abap_timer_manager=>get_timer_manager( )->start_timer( i_timer_handler = lo_t4 i_timeout = lv_ms ).
        log( iv_probe = mv_probe iv_cb = 'TLONG_ARMED' iv_txt = |{ lv_ms }| ).

      WHEN 'ins'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'ins'.
        INSERT zosd_t_ddat FROM ls_dat.
        log( iv_probe = mv_probe iv_cb = 'INS' iv_txt = |{ ls_dat-k } subrc={ sy-subrc }| ).

      WHEN 'insboom'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'insboom'.
        INSERT zosd_t_ddat FROM ls_dat.
        log( iv_probe = mv_probe iv_cb = 'INS' iv_txt = |{ ls_dat-k } subrc={ sy-subrc }| ).
        boom( ).

      WHEN 'insslow'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'insslow'.
        INSERT zosd_t_ddat FROM ls_dat.
        log( iv_probe = mv_probe iv_cb = 'INS' iv_txt = |{ ls_dat-k } subrc={ sy-subrc }| ).
        lv_ms = lv_msf.
        busy( lv_ms ).
        log( iv_probe = mv_probe iv_cb = 'INSSLOW_END' iv_txt = ls_dat-k ).

      WHEN 'commit'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'commit'.
        INSERT zosd_t_ddat FROM ls_dat.
        COMMIT WORK.
        log( iv_probe = mv_probe iv_cb = 'COMMIT_OK' iv_txt = ls_dat-k ).
        lv_ms = lv_msf.
        busy( lv_ms ).
        log( iv_probe = mv_probe iv_cb = 'COMMIT_END' iv_txt = ls_dat-k ).

      WHEN 'rollback'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'rollback'.
        INSERT zosd_t_ddat FROM ls_dat.
        ROLLBACK WORK.
        log( iv_probe = mv_probe iv_cb = 'ROLLBACK_OK' iv_txt = ls_dat-k ).

      WHEN 'wait'.
        ls_dat-k = |{ mv_probe }-{ lv_n }|.
        ls_dat-v = 'wait'.
        INSERT zosd_t_ddat FROM ls_dat.
        log( iv_probe = mv_probe iv_cb = 'WAIT_BEFORE' iv_txt = ls_dat-k ).
        WAIT UP TO 1 SECONDS.
        log( iv_probe = mv_probe iv_cb = 'WAIT_AFTER' iv_txt = |subrc={ sy-subrc }| ).
        lv_ms = lv_msf.
        busy( lv_ms ).
        log( iv_probe = mv_probe iv_cb = 'WAIT_END' iv_txt = ls_dat-k ).

      WHEN 'snt'.
        log( iv_probe = mv_probe iv_cb = 'SNT_BEFORE' ).
        CALL FUNCTION 'RFC_PING' STARTING NEW TASK 'OSGT'
          EXCEPTIONS
            communication_failure = 1
            system_failure        = 2
            resource_failure      = 3
            OTHERS                = 4.
        log( iv_probe = mv_probe iv_cb = 'SNT_AFTER' iv_txt = |subrc={ sy-subrc }| ).

      WHEN 'submit'.
        log( iv_probe = mv_probe iv_cb = 'SUBMIT_BEFORE' ).
        SUBMIT zosd_t_dsub AND RETURN.
        log( iv_probe = mv_probe iv_cb = 'SUBMIT_AFTER' iv_txt = |subrc={ sy-subrc }| ).

      WHEN 'info'.
        TRY.
            DATA(lt_info) = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = 'ZCL_OSD_T_DMN' ).
            log( iv_probe = mv_probe iv_cb = 'INFO_IN_DAEMON' iv_txt = |rows={ lines( lt_info ) }| ).
          CATCH cx_abap_daemon_error INTO DATA(lxi).
            log( iv_probe = mv_probe iv_cb = 'INFO_IN_DAEMON' iv_txt = lxi->get_text( ) ).
        ENDTRY.

      WHEN 'stopme'.
        log( iv_probe = mv_probe iv_cb = 'STOPME' ).
        DATA(lo_sp) = cl_ac_message_type_pcp=>create( ).
        lo_sp->set_text( 'self' ).
        i_context->stop( lo_sp ).
        log( iv_probe = mv_probe iv_cb = 'STOPME_AFTER' ).

      WHEN 'restartme'.
        log( iv_probe = mv_probe iv_cb = 'RESTARTME' iv_txt = |attr=[{ mv_attr }]| ).
        mv_attr = 'before-restart'.
        i_context->restart( ).
        log( iv_probe = mv_probe iv_cb = 'RESTARTME_AFTER' ).

      WHEN 'pcp'.
        DATA(lv_ser) = i_message->serialize( ).
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_ser WITH '<CRLF>'.
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_ser WITH '<LF>'.
        log( iv_probe = mv_probe iv_cb = 'PCP_IN' iv_txt = lv_ser ).

      WHEN 'amcsub'.
        DATA(lv_ch) = i_message->get_field( 'ch' ).
        TRY.
            DATA(lo_c) = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'ZOSD_T_AMC' i_channel_id = CONV #( lv_ch ) ).
            lo_c->start_message_delivery( me ).
            APPEND lo_c TO mt_consumers.
            log( iv_probe = mv_probe iv_cb = 'AMC_SUBSCRIBED' iv_txt = lv_ch ).
          CATCH cx_amc_error INTO DATA(lxa).
            log( iv_probe = mv_probe iv_cb = 'AMC_SUB_ERR' iv_txt = |{ lv_ch }: { lxa->get_text( ) }| ).
        ENDTRY.

      WHEN 'amcsend'.
        TRY.
            log( iv_probe = mv_probe iv_cb = 'AMC_TX_START' iv_txt = |tag={ i_message->get_field( 'tag' ) } n={ lv_n }| ).
            amc_send( iv_ch = i_message->get_field( 'ch' ) iv_tag = i_message->get_field( 'tag' ) iv_n = CONV i( lv_n ) ).
            log( iv_probe = mv_probe iv_cb = 'AMC_TX_END' iv_txt = |tag={ i_message->get_field( 'tag' ) } n={ lv_n }| ).
            lv_ms = lv_msf.
            IF lv_ms > 0.
              busy( lv_ms ).
              log( iv_probe = mv_probe iv_cb = 'AMC_TX_STEP_END' iv_txt = |tag={ i_message->get_field( 'tag' ) }| ).
            ENDIF.
          CATCH cx_amc_error INTO DATA(lxs).
            log( iv_probe = mv_probe iv_cb = 'AMC_TX_ERR' iv_txt = lxs->get_text( ) ).
        ENDTRY.

      WHEN 'amcsendrb' OR 'amcsendboom'.
        TRY.
            amc_send( iv_ch = i_message->get_field( 'ch' ) iv_tag = i_message->get_field( 'tag' ) iv_n = 1 ).
            log( iv_probe = mv_probe iv_cb = 'AMC_TX_END' iv_txt = |tag={ i_message->get_field( 'tag' ) } then={ lv_cmd }| ).
          CATCH cx_amc_error INTO DATA(lxr).
            log( iv_probe = mv_probe iv_cb = 'AMC_TX_ERR' iv_txt = lxr->get_text( ) ).
        ENDTRY.
        lv_ms = lv_msf.
        busy( lv_ms ).
        IF lv_cmd = 'amcsendrb'.
          ROLLBACK WORK.
          log( iv_probe = mv_probe iv_cb = 'AMC_TX_ROLLED_BACK' iv_txt = |tag={ i_message->get_field( 'tag' ) }| ).
        ELSE.
          log( iv_probe = mv_probe iv_cb = 'AMC_TX_BOOM' iv_txt = |tag={ i_message->get_field( 'tag' ) }| ).
          boom( ).
        ENDIF.

      WHEN 'amcstats'.
        LOOP AT mt_amc INTO DATA(ls_amc).
          log( iv_probe = mv_probe iv_cb = 'AMC_STATS' iv_inst = ls_amc-tag iv_txt = |tag={ ls_amc-tag } count={ ls_amc-count } last={ ls_amc-last } gaps={ ls_amc-gaps } switches={ mv_switches }| ).
        ENDLOOP.
        IF mt_amc IS INITIAL.
          log( iv_probe = mv_probe iv_cb = 'AMC_STATS' iv_txt = 'none' ).
        ENDIF.

      WHEN OTHERS.
        log( iv_probe = mv_probe iv_cb = 'UNKNOWN' iv_txt = lv_cmd ).
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
