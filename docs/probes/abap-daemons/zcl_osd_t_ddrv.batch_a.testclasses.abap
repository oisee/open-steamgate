CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p01_serial FOR TESTING RAISING cx_static_check.
    METHODS p02_timers FOR TESTING RAISING cx_static_check.
    METHODS p05_names FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD p01_serial.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P1' iv_probe = 'P1' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'ON_START' ).
    DATA(lo_h) = cl_abap_daemon_client_manager=>attach( lv_inst ).
    DO 20 TIMES.
      zcl_osd_t_ddrv=>send( iv_probe = 'P1' iv_inst = lv_inst iv_cmd = 'busy' iv_n = |{ sy-index }| iv_ms = '200' io_handle = lo_h ).
    ENDDO.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P1' iv_cb = 'ALL_SENT' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'EXIT' iv_count = 20 iv_secs = 30 ).
    zcl_osd_t_ddrv=>info( 'P1' ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P1' iv_cb = 'P9_DRIVER_SEES' iv_txt = |static=[{ zcl_osd_t_dmn=>gv_static }]| ).
    zcl_osd_t_dmn=>gv_static = 'DRIVER'.
    zcl_osd_t_ddrv=>send( iv_probe = 'P1' iv_inst = lv_inst iv_cmd = 'static' io_handle = lo_h ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'STATIC' ).
    DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'pcp' ).
    lo_m->set_field( i_name = 'a' i_value = '1' ).
    lo_m->set_field( i_name = 'b' i_value = 'x:y' ).
    lo_m->set_text( |hello\nworld| ).
    DATA(lv_ser) = lo_m->serialize( ).
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_ser WITH '<CRLF>'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_ser WITH '<LF>'.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P1' iv_cb = 'PCP_OUT' iv_txt = lv_ser ).
    lo_h->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'PCP_IN' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P1' iv_inst = lv_inst iv_cmd = 'info' io_handle = lo_h ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'INFO_IN_DAEMON' ).
    zcl_osd_t_ddrv=>stop( iv_probe = 'P1' iv_inst = lv_inst iv_text = 'bye' ).
    zcl_osd_t_ddrv=>info( 'P1' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P1' iv_cb = 'ON_STOP' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P1' ).
  ENDMETHOD.

  METHOD p02_timers.
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P2' iv_probe = 'P2' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'ON_START' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P2' iv_inst = lv_inst iv_cmd = 'timers' iv_ms = '1,10,50,100,1000' iv_rep = '20' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'TDONE' iv_secs = 45 ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P2' iv_inst = lv_inst iv_cmd = 'tbad' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'TBADDONE' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>send( iv_probe = 'P2' iv_inst = lv_inst iv_cmd = 'tmany' iv_n = '1000' iv_ms = '100' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'TMANY_FIRED' iv_count = 10 iv_secs = 15 ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P2' iv_inst = lv_inst iv_cmd = 'tbusy' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'BUSYEND' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>stop( iv_probe = 'P2' iv_inst = lv_inst ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P2' iv_cb = 'ON_STOP' ).
  ENDMETHOD.

  METHOD p05_names.
    DATA(lv_1) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P5' iv_probe = 'P5' ).
    DATA(lv_2) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P5' iv_probe = 'P5' ).
    DATA(lv_3) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P5B' iv_probe = 'P5' ).
    DATA(lv_4) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P5R' iv_probe = 'P5R' ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P5' iv_cb = 'SAME_ID' iv_txt = |1=2:{ xsdbool( lv_1 = lv_2 ) } 1=3:{ xsdbool( lv_1 = lv_3 ) } 4 initial:{ xsdbool( lv_4 IS INITIAL ) }| ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P5' iv_cb = 'ON_START' iv_count = 3 iv_secs = 5 ).
    zcl_osd_t_ddrv=>info( 'P5' ).
    zcl_osd_t_ddrv=>stop_all( 'P5' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P5' iv_cb = 'ON_STOP' iv_count = 3 iv_secs = 5 ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P5' ).
  ENDMETHOD.
ENDCLASS.
