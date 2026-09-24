CLASS ltcl_p8 DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION MEDIUM.
  PUBLIC SECTION.
    INTERFACES if_amc_message_receiver_pcp.
  PRIVATE SECTION.
    DATA mt_got TYPE string_table.
    METHODS p08a_order FOR TESTING RAISING cx_static_check.
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

  METHOD p08a_order.
    zcl_osd_t_ddrv=>stop_all( 'P0' ).
    COMMIT WORK.
    DATA(lv_r) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P8R' iv_probe = 'P8' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8' iv_cb = 'ON_START' ).
    DATA(lo_h) = cl_abap_daemon_client_manager=>attach( lv_r ).
    DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
    LOOP AT VALUE string_table( ( `/pc` ) ( `/pu` ) ( `/ps` ) ) INTO DATA(lv_ch).
      lo_m = cl_ac_message_type_pcp=>create( ).
      lo_m->set_field( i_name = 'cmd' i_value = 'amcsub' ).
      lo_m->set_field( i_name = 'ch' i_value = lv_ch ).
      lo_h->send( lo_m ).
    ENDLOOP.
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8' iv_cb = 'AMC_SUBSCRIBED' iv_count = 3 iv_secs = 5 ).

    " order: one producer, 1000 messages, then COMMIT WORK
    DATA(lv_t0) = zcl_osd_t_ddrv=>now( ).
    send( iv_ch = `/pc` iv_tag = `A` iv_n = 1000 ).
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'TX_DONE' iv_txt = |tag=A n=1000 ms={ zcl_osd_t_ddrv=>ms( lv_t0 ) }| ).
    COMMIT WORK.
    zcl_osd_t_ddrv=>dlog( iv_probe = 'P8' iv_cb = 'COMMITTED' iv_txt = 'A' ).
    poll( iv_probe = 'P8' iv_tag = 'A' ).

    " two producers: a second daemon sends B while this session sends C
    DATA(lv_s) = zcl_osd_t_ddrv=>start( iv_name = 'OSD_P8S' iv_probe = 'P8S' ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8S' iv_cb = 'ON_START' ).
    lo_m = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcsend' ).
    lo_m->set_field( i_name = 'ch' i_value = '/pc' ).
    lo_m->set_field( i_name = 'tag' i_value = 'B' ).
    lo_m->set_field( i_name = 'n' i_value = '500' ).
    cl_abap_daemon_client_manager=>attach( lv_s )->send( lo_m ).
    send( iv_ch = `/pc` iv_tag = `C` iv_n = 500 ).
    COMMIT WORK.
    poll( iv_probe = 'P8' iv_tag = 'B' ).
    poll( iv_probe = 'P8' iv_tag = 'C' ).

    " scope: user and system channels, same user and client
    send( iv_ch = `/pu` iv_tag = `U` iv_n = 1 ).
    send( iv_ch = `/ps` iv_tag = `S` iv_n = 1 ).
    COMMIT WORK.
    poll( iv_probe = 'P8' iv_tag = 'U' iv_secs = 3 ).
    poll( iv_probe = 'P8' iv_tag = 'S' iv_secs = 3 ).

    lo_m = cl_ac_message_type_pcp=>create( ).
    lo_m->set_field( i_name = 'cmd' i_value = 'amcstats' ).
    lo_h->send( lo_m ).
    zcl_osd_t_ddrv=>waitfor( iv_probe = 'P8' iv_cb = 'AMC_STATS' iv_secs = 5 ).
    zcl_osd_t_ddrv=>stop_all( 'P8END' ).
  ENDMETHOD.

ENDCLASS.
