CLASS zcl_osd_timer_signal DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
    METHODS constructor IMPORTING io_messages TYPE REF TO if_apc_wsp_message_manager
                                  iv_label TYPE string
                                  iv_action TYPE string OPTIONAL
                                  io_target TYPE REF TO if_abap_timer_handler OPTIONAL.
  PRIVATE SECTION.
    DATA mo_messages TYPE REF TO if_apc_wsp_message_manager.
    DATA mv_label TYPE string.
    DATA mv_action TYPE string.
    DATA mo_target TYPE REF TO if_abap_timer_handler.
    DATA mv_fired TYPE i.
ENDCLASS.

CLASS zcl_osd_timer_signal IMPLEMENTATION.
  METHOD constructor.
    mo_messages = io_messages.
    mv_label = iv_label.
    mv_action = iv_action.
    mo_target = io_target.
  ENDMETHOD.

  METHOD if_abap_timer_handler~on_timeout.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    DATA lo_timer TYPE REF TO if_abap_timer_manager.
    mv_fired = mv_fired + 1.
    IF mv_action = 'stop'.
      lo_timer = cl_abap_timer_manager=>get_timer_manager( ).
      lo_timer->stop_timer( mo_target ).
    ELSEIF mv_action = 'rearm' AND mv_fired = 1.
      lo_timer = cl_abap_timer_manager=>get_timer_manager( ).
      lo_timer->start_timer( i_timer_handler = me i_timeout = 0 ).
    ENDIF.
    lo_message = mo_messages->create_message( ).
    lo_message->set_text( mv_label ).
    mo_messages->send( lo_message ).
  ENDMETHOD.
ENDCLASS.
