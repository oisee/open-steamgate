CLASS zcl_osd_t_ddrv DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CONSTANTS co_class TYPE seoclsname VALUE 'ZCL_OSD_T_DMN'.
    TYPES: BEGIN OF ty_field,
             name  TYPE string,
             value TYPE string,
           END OF ty_field,
           tt_field TYPE STANDARD TABLE OF ty_field WITH EMPTY KEY.

    CLASS-METHODS dlog IMPORTING iv_probe TYPE csequence iv_cb TYPE csequence
                                 iv_inst  TYPE csequence OPTIONAL iv_txt TYPE csequence OPTIONAL.
    CLASS-METHODS start IMPORTING iv_name TYPE csequence iv_probe TYPE csequence
                                  it_fields TYPE tt_field OPTIONAL
                        RETURNING VALUE(rv_inst) TYPE string.
    CLASS-METHODS send IMPORTING iv_probe TYPE csequence iv_inst TYPE string iv_cmd TYPE csequence
                                 iv_n TYPE csequence OPTIONAL iv_ms TYPE csequence OPTIONAL
                                 iv_rep TYPE csequence OPTIONAL
                                 io_handle TYPE REF TO if_abap_daemon_handle OPTIONAL
                       RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS stop IMPORTING iv_probe TYPE csequence iv_inst TYPE string
                                 iv_text TYPE csequence OPTIONAL.
    CLASS-METHODS waitfor IMPORTING iv_probe TYPE csequence iv_cb TYPE csequence
                                    iv_count TYPE i DEFAULT 1 iv_secs TYPE i DEFAULT 20
                          RETURNING VALUE(rv_n) TYPE i.
    CLASS-METHODS info IMPORTING iv_probe TYPE csequence.
    CLASS-METHODS stop_all IMPORTING iv_probe TYPE csequence.
    CLASS-METHODS now RETURNING VALUE(rv) TYPE timestampl.
    CLASS-METHODS ms IMPORTING iv_from TYPE timestampl RETURNING VALUE(rv) TYPE string.
ENDCLASS.



CLASS zcl_osd_t_ddrv IMPLEMENTATION.

  METHOD now.
    GET TIME STAMP FIELD rv.
  ENDMETHOD.

  METHOD ms.
    DATA lv_s TYPE p LENGTH 16 DECIMALS 7.
    DATA lv_now TYPE timestampl.
    DATA lv_from TYPE timestampl.
    GET TIME STAMP FIELD lv_now.
    lv_from = iv_from.
    lv_s = cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = lv_from ).
    rv = |{ CONV decfloat34( lv_s * 1000 ) DECIMALS = 3 }|.
  ENDMETHOD.

  METHOD dlog.
    zcl_osd_t_dmn=>log( iv_probe = iv_probe iv_cb = |DRV:{ iv_cb }| iv_inst = iv_inst iv_txt = iv_txt ).
  ENDMETHOD.

  METHOD start.
    DATA lv_mode TYPE i.
    DATA(lv_t0) = now( ).
    TRY.
        DATA(lo_p) = cl_ac_message_type_pcp=>create( ).
        lo_p->set_field( i_name = 'probe' i_value = CONV #( iv_probe ) ).
        LOOP AT it_fields INTO DATA(ls_f).
          lo_p->set_field( i_name = ls_f-name i_value = ls_f-value ).
        ENDLOOP.
        cl_abap_daemon_client_manager=>start(
          EXPORTING i_class_name = co_class
                    i_name       = CONV #( iv_name )
                    i_parameter  = lo_p
          IMPORTING e_setup_mode  = lv_mode
                    e_instance_id = DATA(lv_inst) ).
        rv_inst = lv_inst.
        dlog( iv_probe = iv_probe iv_cb = 'START' iv_inst = rv_inst
              iv_txt = |name={ iv_name } mode={ lv_mode } ms={ ms( lv_t0 ) } len={ strlen( rv_inst ) }| ).
      CATCH cx_root INTO DATA(lx).
        dlog( iv_probe = iv_probe iv_cb = 'START_ERR'
              iv_txt = |name={ iv_name } mode={ lv_mode } { cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

  METHOD send.
    DATA(lv_t0) = now( ).
    TRY.
        DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
        lo_m->set_field( i_name = 'cmd' i_value = CONV #( iv_cmd ) ).
        IF iv_n IS SUPPLIED.
          lo_m->set_field( i_name = 'n' i_value = CONV #( iv_n ) ).
        ENDIF.
        IF iv_ms IS SUPPLIED.
          lo_m->set_field( i_name = 'ms' i_value = CONV #( iv_ms ) ).
        ENDIF.
        IF iv_rep IS SUPPLIED.
          lo_m->set_field( i_name = 'rep' i_value = CONV #( iv_rep ) ).
        ENDIF.
        DATA(lo_h) = io_handle.
        IF lo_h IS NOT BOUND.
          lo_h = cl_abap_daemon_client_manager=>attach( iv_inst ).
        ENDIF.
        lo_h->send( lo_m ).
        rv_ok = abap_true.
        dlog( iv_probe = iv_probe iv_cb = 'SENT' iv_txt = |cmd={ iv_cmd } n={ iv_n } ms={ ms( lv_t0 ) }| ).
      CATCH cx_root INTO DATA(lx).
        dlog( iv_probe = iv_probe iv_cb = 'SEND_ERR'
              iv_txt = |cmd={ iv_cmd } n={ iv_n } ms={ ms( lv_t0 ) } { cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

  METHOD stop.
    DATA(lv_t0) = now( ).
    TRY.
        IF iv_text IS SUPPLIED.
          DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
          lo_m->set_text( CONV #( iv_text ) ).
          lo_m->set_field( i_name = 'why' i_value = 'probe' ).
          cl_abap_daemon_client_manager=>stop( i_instance_id = iv_inst i_parameter = lo_m ).
        ELSE.
          cl_abap_daemon_client_manager=>stop( i_instance_id = iv_inst ).
        ENDIF.
        dlog( iv_probe = iv_probe iv_cb = 'STOPPED' iv_inst = iv_inst iv_txt = |ms={ ms( lv_t0 ) }| ).
      CATCH cx_root INTO DATA(lx).
        dlog( iv_probe = iv_probe iv_cb = 'STOP_ERR' iv_inst = iv_inst
              iv_txt = |ms={ ms( lv_t0 ) } { cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

  METHOD waitfor.
    DATA(lv_t0) = now( ).
    DATA(lv_loops) = iv_secs * 5.
    DO lv_loops TIMES.
      SELECT COUNT(*) FROM zosd_t_dlog WHERE probe = @iv_probe AND cb = @iv_cb INTO @rv_n.
      IF rv_n >= iv_count.
        EXIT.
      ENDIF.
      WAIT UP TO '0.2' SECONDS.
    ENDDO.
    dlog( iv_probe = iv_probe iv_cb = 'WAITFOR' iv_txt = |cb={ iv_cb } want={ iv_count } got={ rv_n } ms={ ms( lv_t0 ) }| ).
  ENDMETHOD.

  METHOD info.
    TRY.
        DATA(lt) = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = co_class ).
        dlog( iv_probe = iv_probe iv_cb = 'INFO' iv_txt = |rows={ lines( lt ) }| ).
        LOOP AT lt INTO DATA(ls).
          dlog( iv_probe = iv_probe iv_cb = 'INFO_ROW' iv_inst = ls-instance_id
                iv_txt = |name={ ls-name } cclient={ ls-creator_client } cuser={ ls-creator_user } dest={ ls-used_dest } created={ ls-creation_time }| ).
        ENDLOOP.
      CATCH cx_root INTO DATA(lx).
        dlog( iv_probe = iv_probe iv_cb = 'INFO_ERR' iv_txt = lx->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD stop_all.
    TRY.
        DATA(lt) = cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = co_class ).
        LOOP AT lt INTO DATA(ls).
          stop( iv_probe = iv_probe iv_inst = ls-instance_id ).
        ENDLOOP.
        dlog( iv_probe = iv_probe iv_cb = 'STOP_ALL' iv_txt = |rows={ lines( lt ) }| ).
      CATCH cx_root INTO DATA(lx).
        dlog( iv_probe = iv_probe iv_cb = 'STOP_ALL_ERR' iv_txt = lx->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
