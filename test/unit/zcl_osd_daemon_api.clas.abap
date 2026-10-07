CLASS zcl_osd_daemon_api DEFINITION PUBLIC INHERITING FROM cl_abap_daemon_ext_base CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS start_low RETURNING VALUE(rv_id) TYPE abap_daemon_info-instance_id RAISING cx_abap_daemon_error.
    CLASS-METHODS initial_info RAISING cx_abap_daemon_error.
    METHODS if_abap_daemon_extension~on_accept REDEFINITION.
    METHODS if_abap_daemon_extension~on_start REDEFINITION.
    METHODS if_abap_daemon_extension~on_message REDEFINITION.
    METHODS if_abap_daemon_extension~on_stop REDEFINITION.
    METHODS if_abap_daemon_extension~on_error REDEFINITION.
    METHODS if_abap_daemon_extension~on_restart REDEFINITION.
    METHODS if_abap_daemon_extension~on_before_restart_by_system REDEFINITION.
    METHODS if_abap_daemon_extension~on_server_shutdown REDEFINITION.
    METHODS if_abap_daemon_extension~on_system_shutdown REDEFINITION.
ENDCLASS.
CLASS zcl_osd_daemon_api IMPLEMENTATION.
  METHOD start_low.
    DATA lt_info TYPE cl_abap_daemon_client_manager=>tt_info.
    DATA ls_new LIKE LINE OF lt_info.
    DATA lv_setup TYPE i.
    cl_abap_daemon_client_manager=>start(
      EXPORTING i_daemon_id = 'ZOSD_API' i_class_name = 'ZCL_OSD_DAEMON_API'
                i_destination = 'NONE' i_name = 'low'
                i_priority = cl_abap_daemon_client_manager=>co_session_priority_low
      IMPORTING e_setup_mode = lv_setup e_instance_id = ls_new-instance_id ).
    ASSERT lv_setup = if_abap_daemon_extension=>co_setup_mode-accept.
    lt_info = cl_abap_daemon_client_manager=>get_daemon_info( i_daemon_id = 'ZOSD_API' ).
    ASSERT lines( lt_info ) = 1.
    READ TABLE lt_info INDEX 1 INTO ls_new.
    rv_id = ls_new-instance_id.
    cl_abap_daemon_client_manager=>stop( i_instance_id = rv_id ).
  ENDMETHOD.
  METHOD initial_info.
    cl_abap_daemon_client_manager=>get_daemon_info( ).
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_accept.
    e_setup_mode = if_abap_daemon_extension=>co_setup_mode-accept.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_start.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_message.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_stop.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_error.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_restart.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_before_restart_by_system.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_server_shutdown.
  ENDMETHOD.
  METHOD if_abap_daemon_extension~on_system_shutdown.
  ENDMETHOD.
ENDCLASS.
