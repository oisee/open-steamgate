CLASS zcl_osd_timer_probe DEFINITION PUBLIC INHERITING FROM cl_apc_wsp_ext_stateful_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_message REDEFINITION.
  PRIVATE SECTION.
    DATA mo_last TYPE REF TO if_abap_timer_handler.
    METHODS send IMPORTING io_messages TYPE REF TO if_apc_wsp_message_manager
                           iv_text TYPE string.
ENDCLASS.

CLASS zcl_osd_timer_probe IMPLEMENTATION.
  METHOD if_apc_wsp_extension~on_message.
    DATA lv_text TYPE string.
    DATA lv_command TYPE string.
    DATA lv_timeout_text TYPE string.
    DATA lv_timeout TYPE i.
    DATA lv_label TYPE string.
    DATA lo_timer TYPE REF TO if_abap_timer_manager.
    DATA lo_handler TYPE REF TO zcl_osd_timer_signal.
    DATA lo_target TYPE REF TO zcl_osd_timer_signal.
    DATA lo_error TYPE REF TO cx_abap_timer_error.

    lv_text = i_message->get_text( ).
    SPLIT lv_text AT ':' INTO lv_command lv_timeout_text lv_label.
    lv_timeout = lv_timeout_text.
    lo_timer = cl_abap_timer_manager=>get_timer_manager( ).
    CASE lv_command.
      WHEN 'arm' OR 'orphan' OR 'double'.
        CREATE OBJECT lo_handler EXPORTING io_messages = i_message_manager iv_label = lv_label.
        lo_timer->start_timer( i_timer_handler = lo_handler i_timeout = lv_timeout ).
        IF lv_command = 'double'.
          TRY.
              lo_timer->start_timer( i_timer_handler = lo_handler i_timeout = lv_timeout ).
            CATCH cx_abap_timer_error INTO lo_error.
              send( io_messages = i_message_manager iv_text = lo_error->get_text( ) ).
          ENDTRY.
        ENDIF.
        IF lv_command <> 'orphan'.
          mo_last = lo_handler.
        ENDIF.
        send( io_messages = i_message_manager iv_text = 'armed' ).
      WHEN 'stop'.
        TRY.
            lo_timer->stop_timer( mo_last ).
            send( io_messages = i_message_manager iv_text = 'stopped' ).
          CATCH cx_abap_timer_error INTO lo_error.
            send( io_messages = i_message_manager iv_text = lo_error->get_text( ) ).
        ENDTRY.
      WHEN 'idle-stop'.
        CREATE OBJECT lo_handler EXPORTING io_messages = i_message_manager iv_label = 'never'.
        TRY.
            lo_timer->stop_timer( lo_handler ).
          CATCH cx_abap_timer_error INTO lo_error.
            send( io_messages = i_message_manager iv_text = lo_error->get_text( ) ).
        ENDTRY.
      WHEN 'rearm'.
        CREATE OBJECT lo_handler EXPORTING io_messages = i_message_manager iv_label = 'tick' iv_action = 'rearm'.
        lo_timer->start_timer( i_timer_handler = lo_handler i_timeout = 0 ).
        send( io_messages = i_message_manager iv_text = 'armed' ).
      WHEN 'stop-other'.
        CREATE OBJECT lo_target EXPORTING io_messages = i_message_manager iv_label = 'target'.
        lo_timer->start_timer( i_timer_handler = lo_target i_timeout = 50 ).
        CREATE OBJECT lo_handler EXPORTING io_messages = i_message_manager iv_label = 'controller'
          iv_action = 'stop' io_target = lo_target.
        lo_timer->start_timer( i_timer_handler = lo_handler i_timeout = 0 ).
        send( io_messages = i_message_manager iv_text = 'armed' ).
      WHEN 'bulk'.
        DO 1000 TIMES.
          CREATE OBJECT lo_handler EXPORTING io_messages = i_message_manager iv_label = 'bulk'.
          lo_timer->start_timer( i_timer_handler = lo_handler i_timeout = 0 ).
        ENDDO.
        send( io_messages = i_message_manager iv_text = 'armed' ).
    ENDCASE.
  ENDMETHOD.

  METHOD send.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    lo_message = io_messages->create_message( ).
    lo_message->set_text( iv_text ).
    io_messages->send( lo_message ).
  ENDMETHOD.
ENDCLASS.
