* A push channel of our own, so the mount is proven by something this
* repository controls rather than by an application it does not.
*
* It is a real APC handler: it inherits cl_apc_wsp_ext_stateful_base and
* redefines the callbacks a system calls, so the same class would run in a
* system's ICF unchanged. Stateful means the object outlives one message,
* which is what the counter is here to demonstrate — a handler that answered
* identically every time would not tell us whether state survived.
CLASS zcl_stg_apc_demo DEFINITION PUBLIC INHERITING FROM cl_apc_wsp_ext_stateful_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
    METHODS if_apc_wsp_extension~on_message REDEFINITION.
    METHODS if_apc_wsp_extension~on_close REDEFINITION.
  PRIVATE SECTION.
    DATA mv_seen TYPE i.

    METHODS send_text
      IMPORTING
        io_manager TYPE REF TO if_apc_wsp_message_manager
        iv_text    TYPE string
      RAISING
        cx_apc_error.
ENDCLASS.

CLASS zcl_stg_apc_demo IMPLEMENTATION.

  METHOD if_apc_wsp_extension~on_start.
*   a handler is allowed to speak first, and this one does: a client that
*   hears nothing cannot tell an open channel from a broken one
    mv_seen = 0.
    send_text( io_manager = i_message_manager
               iv_text    = |\{"type":"hello","channel":"ZSTG_APC_DEMO"\}| ).
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_message.
    DATA lv_text TYPE string.

    lv_text = i_message->get_text( ).
    mv_seen = mv_seen + 1.

    CASE lv_text.
      WHEN 'ping'.
        send_text( io_manager = i_message_manager iv_text = 'pong' ).
      WHEN OTHERS.
*       the count is the point: it proves one object served both messages
        send_text( io_manager = i_message_manager
                   iv_text    = |\{"type":"echo","seen":{ mv_seen },"text":"{ lv_text }"\}| ).
    ENDCASE.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_close.
    CLEAR mv_seen.
  ENDMETHOD.

  METHOD send_text.
    DATA lo_message TYPE REF TO if_apc_wsp_message.

    lo_message = io_manager->create_message( ).
    lo_message->set_text( iv_text ).
    io_manager->send( lo_message ).
  ENDMETHOD.

ENDCLASS.
