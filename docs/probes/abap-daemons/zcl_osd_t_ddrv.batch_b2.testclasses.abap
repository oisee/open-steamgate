CLASS ltcl DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PRIVATE SECTION.
    METHODS p04_limits FOR TESTING RAISING cx_static_check.
    METHODS count IMPORTING iv_probe TYPE csequence iv_cb TYPE csequence RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS ltcl IMPLEMENTATION.
  METHOD count.
    SELECT COUNT(*) FROM zosd_t_dlog WHERE probe = @iv_probe AND cb = @iv_cb INTO @rv.
  ENDMETHOD.

  METHOD p04_limits.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    WAIT UP TO 1 SECONDS.
    DATA(lv_inst) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4' iv_probe = 'P4B' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P4B' iv_cb = 'ON_START' ).
    DO 30 TIMES.
      DATA(lv_i) = sy-index.
      DATA(lv_before) = count( iv_probe = 'P4B' iv_cb = 'ON_ERROR' ).
      DATA(lv_ok) = zcl_osd_t_ddrv=>send( iv_probe = 'P4B' iv_inst = lv_inst iv_cmd = 'boom' iv_n = |{ lv_i }| ).
      IF lv_ok = abap_false.
        zcl_osd_t_ddrv=>info( 'P4B' ).
        EXIT.
      ENDIF.
      DO 10 TIMES.
        IF count( iv_probe = 'P4B' iv_cb = 'ON_ERROR' ) > lv_before.
          EXIT.
        ENDIF.
        WAIT UP TO '0.1' SECONDS.
      ENDDO.
    ENDDO.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P4B' iv_cb = 'ROUNDS' iv_txt = |errors={ count( iv_probe = 'P4B' iv_cb = 'ON_ERROR' ) } booms={ count( iv_probe = 'P4B' iv_cb = 'BOOM' ) }| ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P4B' iv_inst = lv_inst iv_cmd = 'busy' iv_n = 'alive' iv_ms = '0' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4B' ).

    DATA(lt_f) = VALUE zcl_osd_t_ddrv=>tt_field( ( name = 'startboom' value = 'X' ) ).
    DATA(lv_s) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4S' iv_probe = 'P4S' it_fields = lt_f ).
    WAIT UP TO 5 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4S' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P4S' iv_inst = lv_s iv_cmd = 'busy' iv_n = '1' iv_ms = '0' ).

    lt_f = VALUE #( ( name = 'tickboom' value = 'X' ) ).
    DATA(lv_t) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P4T' iv_probe = 'P4T' it_fields = lt_f ).
    WAIT UP TO 5 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4T' ).
    zcl_osd_t_ddrv=>send( iv_probe = 'P4T' iv_inst = lv_t iv_cmd = 'busy' iv_n = '1' iv_ms = '0' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>stop_all( 'P4END' ).
    WAIT UP TO 1 SECONDS.
    zcl_osd_t_ddrv=>info( 'P4END' ).
  ENDMETHOD.
ENDCLASS.
