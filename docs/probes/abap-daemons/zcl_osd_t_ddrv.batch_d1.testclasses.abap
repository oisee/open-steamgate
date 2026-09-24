CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p10_phase1 FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD p10_phase1.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P10' iv_probe = 'P10' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P10' iv_cb = 'ON_START' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P10' iv_inst = lv_inst iv_cmd = 'ver' iv_n = '1' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P10' iv_inst = lv_inst iv_cmd = 'tlong' iv_n = '1' iv_ms = '45000' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P10' iv_cb = 'TLONG_ARMED' ).
    " P6: another program
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P6' iv_cb = 'OTHER_INFO' iv_txt = zcl_osd_t_other=>info_rows( ) ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P6' iv_cb = 'OTHER_SEND' iv_txt = zcl_osd_t_other=>send_ver( lv_inst ) ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P10' iv_cb = 'VER' iv_count = 2 ).
    zcl_osd_t_ddrv=>info( 'P10' ).
  ENDMETHOD.
ENDCLASS.
