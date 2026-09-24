CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PUBLIC SECTION.
    INTERFACES if_amc_message_receiver_pcp.
  PRIVATE SECTION.
    DATA mv_got TYPE i.
    METHODS p11_stop FOR TESTING RAISING cx_static_check.
    METHODS p08_amc FOR TESTING RAISING cx_static_check.
    METHODS err IMPORTING ix TYPE REF TO cx_root RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD err.
    rv = |{ cl_abap_classdescr=>get_class_name( ix ) }: { ix->get_text( ) }|.
  ENDMETHOD.

  METHOD if_amc_message_receiver_pcp~receive.
    mv_got = mv_got + 1.
    TRY.
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'AMC_RECEIVED' iv_txt = |n={ mv_got } text={ i_message->get_text( ) } from_client_same={ xsdbool( i_context->get_producer_client( ) = sy-mandt ) }| ).
      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.

  METHOD p11_stop.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P11' iv_probe = 'P11' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P11' iv_cb = 'ON_START' ).
    DATA(lo_h) = cl_abap_daemon_client_manager=>attach( lv_inst ).
    DO 5 TIMES.
      zcl_osd_t_ddrv=>send( iv_probe = 'P11' iv_inst = lv_inst iv_cmd = 'busy' iv_n = |{ sy-index }| iv_ms = '300' io_handle = lo_h ).
    ENDDO.
    zcl_osd_t_ddrv=>stop( iv_probe = 'P11' iv_inst = lv_inst iv_text = 'bye' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11' iv_inst = lv_inst iv_cmd = 'busy' iv_n = 'after-stop-old-handle' iv_ms = '0' io_handle = lo_h ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11' iv_inst = lv_inst iv_cmd = 'busy' iv_n = 'after-stop-new-attach' iv_ms = '0' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P11' iv_cb = 'ON_STOP' iv_secs = 5 ).
    WAIT UP TO 2 SECONDS.
    zcl_osd_t_ddrv=>send( iv_probe = 'P11' iv_inst = lv_inst iv_cmd = 'busy' iv_n = 'late-old-handle' iv_ms = '0' io_handle = lo_h ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11' iv_inst = lv_inst iv_cmd = 'busy' iv_n = 'late-new-attach' iv_ms = '0' ).
    zcl_osd_t_ddrv=>stop( iv_probe = 'P11' iv_inst = lv_inst ).
    zcl_osd_t_ddrv=>stop( iv_probe = 'P11' iv_inst = 'bm9uc2Vuc2U=' ).
    zcl_osd_t_ddrv=>info( 'P11' ).

    " restart and stop from inside
    DATA(lv_r) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P11R' iv_probe = 'P11R' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P11R' iv_cb = 'ON_START' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'ver' iv_n = 'a' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'restartme' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'ver' iv_n = 'b' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P11R' iv_cb = 'VER' iv_count = 2 iv_secs = 5 ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'stopme' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'busy' iv_n = 'after-stopme' iv_ms = '0' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P11R' iv_cb = 'ON_STOP' iv_secs = 5 ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>send( iv_probe = 'P11R' iv_inst = lv_r iv_cmd = 'busy' iv_n = 'late' iv_ms = '0' ).
    zcl_osd_t_ddrv=>info( 'P11R' ).
  ENDMETHOD.

  METHOD p08_amc.
    DATA lo_prod TYPE REF TO if_amc_message_producer_pcp.
    " consumer session id: only its length is recorded
    TRY.
        DATA(lv_sid) = cl_amc_channel_manager=>get_consumer_session_id( ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'SESSION_ID' iv_txt = |len={ strlen( lv_sid ) }| ).
      CATCH cx_root INTO DATA(lx0).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'SESSION_ID' iv_txt = err( lx0 ) ).
    ENDTRY.
    " synchronous communication type
    TRY.
        cl_amc_channel_manager=>create_message_producer(
          i_application_id = 'ABAP_DAEMON_TESTS' i_channel_id = '/ut_channel'
          i_communication_type = cl_amc_channel_manager=>co_comm_type_synchronous ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'SYNC_PRODUCER' iv_txt = 'created' ).
      CATCH cx_root INTO DATA(lx1).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'SYNC_PRODUCER' iv_txt = err( lx1 ) ).
    ENDTRY.
    " a channel that does not exist
    TRY.
        cl_amc_channel_manager=>create_message_producer( i_application_id = 'ZOSD_NO_SUCH_APP' i_channel_id = '/x' ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'NO_CHANNEL' iv_txt = 'created' ).
      CATCH cx_root INTO DATA(lx2).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'NO_CHANNEL' iv_txt = err( lx2 ) ).
    ENDTRY.
    " consumer on a channel this program is not authorised for
    TRY.
        DATA(lo_cons) = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'ABAP_DAEMON_TESTS' i_channel_id = '/ut_channel' ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'CONSUMER' iv_txt = 'created' ).
        lo_cons->start_message_delivery( me ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'CONSUMER' iv_txt = 'delivery started' ).
      CATCH cx_root INTO DATA(lx3).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'CONSUMER' iv_txt = err( lx3 ) ).
    ENDTRY.
    " producer on the same channel
    TRY.
        lo_prod ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'ABAP_DAEMON_TESTS' i_channel_id = '/ut_channel' ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'PRODUCER' iv_txt = 'created' ).
        DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
        lo_m->set_text( 'osd-probe' ).
        lo_prod->send( lo_m ).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'PRODUCER' iv_txt = 'sent' ).
        WAIT FOR MESSAGING CHANNELS UNTIL mv_got >= 1 UP TO 2 SECONDS.
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'WAIT_AMC' iv_txt = |subrc={ sy-subrc } got={ mv_got }| ).
      CATCH cx_root INTO DATA(lx4).
        zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'PRODUCER' iv_txt = err( lx4 ) ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
