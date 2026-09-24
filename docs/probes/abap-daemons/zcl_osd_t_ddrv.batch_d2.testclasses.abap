CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p10_phase2 FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD p10_phase2.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P10' iv_cb = 'PHASE2' ).
    DATA(lt) = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = 'ZCL_OSD_T_DMN' ).
    READ TABLE lt INTO DATA(ls) WITH KEY name = 'OSD_P10'.
    DATA(lv_inst) = ls-instance_id.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P10' iv_cb = 'FOUND' iv_txt = |rows={ lines( lt ) } found={ xsdbool( lv_inst IS NOT INITIAL ) }| ).
    " wait for the timer armed before the re-activation, sending nothing
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P10' iv_cb = 'TFIRE' iv_secs = 35 ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P10' iv_inst = lv_inst iv_cmd = 'ver' iv_n = '2' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P10' iv_cb = 'VER' iv_count = 3 iv_secs = 5 ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P10' ).
    zcl_osd_t_ddrv=>stop_all( 'P10END' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P10END' ).
  ENDMETHOD.
ENDCLASS.
