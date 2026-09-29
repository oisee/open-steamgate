CLASS zcl_osd_timer_signal DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
    METHODS constructor IMPORTING io_messages TYPE REF TO if_apc_wsp_message_manager
                                  iv_label TYPE string.
  PRIVATE SECTION.
    DATA mo_messages TYPE REF TO if_apc_wsp_message_manager.
    DATA mv_label TYPE string.
ENDCLASS.

CLASS zcl_osd_timer_signal IMPLEMENTATION.
  METHOD constructor.
    mo_messages = io_messages.
    mv_label = iv_label.
  ENDMETHOD.

  METHOD if_abap_timer_handler~on_timeout.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    lo_message = mo_messages->create_message( ).
    lo_message->set_text( mv_label ).
    mo_messages->send( lo_message ).
  ENDMETHOD.
ENDCLASS.
