CLASS ltcl_p8 DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PUBLIC SECTION.
    INTERFACES if_amc_message_receiver_pcp.
  PRIVATE SECTION.
    DATA mt_got TYPE string_table.
    METHODS p08b_luw FOR TESTING RAISING cx_static_check.
    METHODS send IMPORTING iv_ch TYPE string iv_tag TYPE string iv_n TYPE i
                           iv_suppress_echo TYPE abap_bool DEFAULT abap_false
                 RAISING cx_static_check.
    METHODS rx IMPORTING iv_probe TYPE csequence iv_tag TYPE csequence RETURNING VALUE(rv) TYPE i.
    METHODS poll IMPORTING iv_probe TYPE csequence iv_tag TYPE csequence iv_secs TYPE i DEFAULT 10
                 RETURNING VALUE(rv) TYPE i.
    METHODS busy IMPORTING iv_ms TYPE i.
ENDCLASS.

CLASS ltcl_p8 IMPLEMENTATION.
  METHOD if_amc_message_receiver_pcp~receive.
    TRY.
        DATA(lv_tag) = i_message->get_field( 'tag' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    APPEND lv_tag TO mt_got.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'SELF_RX' iv_txt = |tag={ lv_tag }| ).
  ENDMETHOD.

  METHOD send.
    DATA lo_p TYPE REF TO if_amc_message_producer_pcp.
    lo_p ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_T_AMC' i_channel_id = iv_ch i_suppress_echo = iv_suppress_echo ).
    DO iv_n TIMES.
      DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
      lo_m->set_field( i_name = 'tag' i_value = iv_tag ).
      lo_m->set_field( i_name = 'seq' i_value = |{ sy-index }| ).
      lo_m->set_field( i_name = 'total' i_value = |{ iv_n }| ).
      lo_m->set_field( i_name = 'ch' i_value = iv_ch ).
      lo_p->send( lo_m ).
    ENDDO.
  ENDMETHOD.

  METHOD rx.
    SELECT COUNT(*) FROM zosd_t_dlog WHERE probe = @iv_probe AND cb = 'AMC_RX_END' AND inst = @iv_tag INTO @rv.
  ENDMETHOD.

  METHOD poll.
    DATA(lv_t0) = zcl_osd_t_ddrv=>now( ).
    DO iv_secs * 10 TIMES.
      rv = rx( iv_probe = iv_probe iv_tag = iv_tag ).
      IF rv > 0.
        EXIT.
      ENDIF.
      WAIT UP TO '0.1' SECONDS.
    ENDDO.
    zcl_osd_t_ddrv=>dlog( iv_probe = iv_probe iv_cb = 'POLL' iv_txt = |tag={ iv_tag } got={ rv } ms={ zcl_osd_t_ddrv=>ms( lv_t0 ) }| ).
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

  METHOD p08b_luw.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    COMMIT WORK.
    DATA(lv_r) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P8R' iv_probe = 'P8B' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8B' iv_cb = 'ON_START' ).
    DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcsub' ).
    lo_m->set_field( i_name = 'ch' i_value = '/pc' ).
    cl_abap_daemon_client_manager=>attach( lv_r )->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8B' iv_cb = 'AMC_SUBSCRIBED' iv_secs = 5 ).

    " delivery at SEND or at COMMIT WORK
    send( iv_ch = `/pc` iv_tag = `X` iv_n = 1 ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'X_SENT' ).
    busy( 1500 ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'X_BEFORE_COMMIT' iv_txt = |received={ rx( iv_probe = 'P8B' iv_tag = 'X' ) }| ).
    COMMIT WORK.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'COMMITTED' iv_txt = 'X' ).
    poll( iv_probe = 'P8B' iv_tag = 'X' iv_secs = 3 ).

    " a message sent in a LUW that is rolled back
    send( iv_ch = `/pc` iv_tag = `Y` iv_n = 1 ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'Y_SENT' ).
    busy( 500 ).
    ROLLBACK WORK.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'ROLLED_BACK' iv_txt = 'Y' ).
    poll( iv_probe = 'P8B' iv_tag = 'Y' iv_secs = 3 ).

    " echo: this session subscribes too
    TRY.
        DATA(lo_c) = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'ZOSD_T_AMC' i_channel_id = '/pc' ).
        lo_c->start_message_delivery( me ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'SELF_SUBSCRIBED' ).
      CATCH cx_amc_error INTO DATA(lx).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'SELF_SUB_ERR' iv_txt = lx->get_text( ) ).
    ENDTRY.
    " labels: ECHO_OFF = echo suppression off (i_suppress_echo = abap_false),
    " ECHO_ON = echo suppression on (i_suppress_echo = abap_true)
    send( iv_ch = `/pc` iv_tag = `E1` iv_n = 1 iv_suppress_echo = abap_false ).
    COMMIT WORK.
    WAIT FOR MESSAGING CHANNELS UNTIL lines( mt_got ) >= 1 UP TO 2 SECONDS.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'ECHO_OFF' iv_txt = |subrc={ sy-subrc } got={ concat_lines_of( table = mt_got sep = `,` ) }| ).
    send( iv_ch = `/pc` iv_tag = `E2` iv_n = 1 iv_suppress_echo = abap_true ).
    COMMIT WORK.
    WAIT FOR MESSAGING CHANNELS UNTIL lines( mt_got ) >= 2 UP TO 2 SECONDS.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8B' iv_cb = 'ECHO_ON' iv_txt = |subrc={ sy-subrc } got={ concat_lines_of( table = mt_got sep = `,` ) }| ).
    poll( iv_probe = 'P8B' iv_tag = 'E2' iv_secs = 3 ).

    " a daemon as producer: SEND inside its callback, then 1.5 s more work
    DATA(lv_s) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P8S' iv_probe = 'P8BS' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8BS' iv_cb = 'ON_START' ).
    lo_m = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcsend' ).
    lo_m->set_field( i_name = 'ch' i_value = '/pc' ).
    lo_m->set_field( i_name = 'tag' i_value = 'Z' ).
    lo_m->set_field( i_name = 'n' i_value = '1' ).
    lo_m->set_field( i_name = 'ms' i_value = '1500' ).
    cl_abap_daemon_client_manager=>attach( lv_s )->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8BS' iv_cb = 'AMC_TX_STEP_END' iv_secs = 5 ).
    poll( iv_probe = 'P8B' iv_tag = 'Z' iv_secs = 3 ).

    " a daemon step that sends and then rolls back; one that sends and then dumps
    lo_m = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcsendrb' ).
    lo_m->set_field( i_name = 'ch' i_value = '/pc' ).
    lo_m->set_field( i_name = 'tag' i_value = 'R' ).
    lo_m->set_field( i_name = 'ms' i_value = '500' ).
    cl_abap_daemon_client_manager=>attach( lv_s )->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8BS' iv_cb = 'AMC_TX_ROLLED_BACK' iv_secs = 5 ).
    poll( iv_probe = 'P8B' iv_tag = 'R' iv_secs = 3 ).
    lo_m = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcsendboom' ).
    lo_m->set_field( i_name = 'ch' i_value = '/pc' ).
    lo_m->set_field( i_name = 'tag' i_value = 'K' ).
    lo_m->set_field( i_name = 'ms' i_value = '500' ).
    cl_abap_daemon_client_manager=>attach( lv_s )->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8BS' iv_cb = 'ON_ERROR' iv_secs = 5 ).
    poll( iv_probe = 'P8B' iv_tag = 'K' iv_secs = 3 ).
    zcl_osd_t_ddrv=>stop_all( 'P8END' ).
  ENDMETHOD.
ENDCLASS.
