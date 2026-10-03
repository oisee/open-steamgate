CLASS zcl_l3_fleet2_dmn DEFINITION PUBLIC INHERITING FROM cl_abap_daemon_ext_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
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
    DATA mo_context TYPE REF TO if_abap_daemon_context.
    METHODS arm.
    METHODS pass.
ENDCLASS.
CLASS zcl_l3_fleet2_dmn IMPLEMENTATION.
  METHOD if_abap_daemon_extension~on_accept.
    e_setup_mode = 1.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_start.
    mo_context = i_context.
    pass( ).
    arm( ).
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_restart.
    mo_context = i_context.
    pass( ).
    arm( ).
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_error.
    mo_context = i_context.
    arm( ).
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_message.
    mo_context = i_context.
    pass( ).
  ENDMETHOD.
  METHOD if_abap_timer_handler~on_timeout.
    pass( ).
    arm( ).
  ENDMETHOD.
  METHOD pass.
    IF zcl_l3_fleet2=>watcher_pass( ) = abap_false.
      TRY.
          mo_context->stop( ).
        CATCH cx_abap_daemon_error.
      ENDTRY.
    ENDIF.
  ENDMETHOD.
  METHOD arm.
    DATA lo_timer TYPE REF TO if_abap_timer_manager.
    DATA lv_millis TYPE i.
    zcl_l3_fleet2=>arm_tick( ).
    lv_millis = zcl_l3_fleet2=>doctor_tick( ) * 1000.
    TRY.
        lo_timer = cl_abap_timer_manager=>get_timer_manager( ).
        lo_timer->start_timer( i_timer_handler = me i_timeout = lv_millis ).
      CATCH cx_abap_timer_error.
    ENDTRY.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_stop.
    zcl_l3_fleet2=>watcher_audit( 'DMN-STOP' ).
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_before_restart_by_system.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_server_shutdown.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_system_shutdown.
  ENDMETHOD.
ENDCLASS.
