CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p03_dump FOR TESTING RAISING cx_static_check.
    METHODS p04_limits FOR TESTING RAISING cx_static_check.
    METHODS count IMPORTING iv_probe TYPE csequence iv_cb TYPE csequence RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD count.
    SELECT COUNT(*) FROM zosd_t_dlog WHERE probe = @iv_probe AND cb = @iv_cb INTO @rv.
  ENDMETHOD.

  METHOD p03_dump.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P3' iv_probe = 'P3' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P3' iv_cb = 'ON_START' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'ver' iv_n = 'a' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'busy' iv_n = '1' iv_ms = '0' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'boom' iv_n = '2' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'busy' iv_n = '3' iv_ms = '0' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'ver' iv_n = 'b' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'busy' iv_n = '4' iv_ms = '0' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P3' iv_cb = 'VER' iv_count = 2 iv_secs = 15 ).
    WAIT UP TO 2 SECONDS.
    zcl_osd_t_ddrv=>info( 'P3' ).
    " after the restart: messages sent now
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'busy' iv_n = '5' iv_ms = '0' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P3' iv_inst = lv_inst iv_cmd = 'timers' iv_ms = '1' iv_rep = '3' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P3' iv_cb = 'TDONE' iv_secs = 5 ).
    zcl_osd_t_ddrv=>stop( iv_probe = 'P3' iv_inst = lv_inst ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P3' iv_cb = 'ON_STOP' ).
  ENDMETHOD.

  METHOD p04_limits.
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4' iv_probe = 'P4' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P4' iv_cb = 'ON_START' ).
    DO 12 TIMES.
      DATA(lv_i) = sy-index.
      DATA(lv_before) = count( iv_probe = 'P4' iv_cb = 'ON_RESTART' ).
      DATA(lv_ok) = zcl_osd_t_ddrv=>send( iv_probe = 'P4' iv_inst = lv_inst iv_cmd = 'boom' iv_n = |{ lv_i }| ).
      IF lv_ok = abap_false.
        zcl_osd_t_ddrv=>info( 'P4' ).
        EXIT.
      ENDIF.
      DO 25 TIMES.
        IF count( iv_probe = 'P4' iv_cb = 'ON_RESTART' ) > lv_before.
          EXIT.
        ENDIF.
        WAIT UP TO '0.2' SECONDS.
      ENDDO.
      zcl_osd_t_ddrv=>dlog( iv_probe = 'P4' iv_cb = 'ROUND' iv_txt = |i={ lv_i } restarts={ count( iv_probe = 'P4' iv_cb = 'ON_RESTART' ) } errors={ count( iv_probe = 'P4' iv_cb = 'ON_ERROR' ) }| ).
    ENDDO.
    zcl_osd_t_ddrv=>info( 'P4' ).

    DATA(lt_f) = VALUE zcl_osd_t_ddrv=>tt_field( ( name = 'startboom' value = 'X' ) ).
    DATA(lv_s) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4S' iv_probe = 'P4S' it_fields = lt_f ).
    WAIT UP TO 8 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4S' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P4S' iv_inst = lv_s iv_cmd = 'busy' iv_n = '1' iv_ms = '0' ).

    lt_f = VALUE #( ( name = 'tickboom' value = 'X' ) ).
    DATA(lv_t) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4T' iv_probe = 'P4T' it_fields = lt_f ).
    WAIT UP TO 10 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4T' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P4T' iv_inst = lv_t iv_cmd = 'busy' iv_n = '1' iv_ms = '0' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>stop_all( 'P4END' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4END' ).
  ENDMETHOD.
ENDCLASS.
