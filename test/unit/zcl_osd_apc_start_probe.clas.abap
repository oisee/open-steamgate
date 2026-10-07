CLASS zcl_osd_apc_start_probe DEFINITION PUBLIC INHERITING FROM cl_apc_wsp_ext_stateful_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
  PRIVATE SECTION.
    DATA mv_operation TYPE string.
    DATA mo_messages TYPE REF TO if_apc_wsp_message_manager.
ENDCLASS.

CLASS zcl_osd_apc_start_probe IMPLEMENTATION.
  METHOD if_apc_wsp_extension~on_start.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lo_timer TYPE REF TO if_abap_timer_manager.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    mo_messages = i_message_manager.
    ls_answer = zcl_osd_adt_host=>store( iv_command = 'ACTIVATE'
      iv_type = 'CLAS' iv_name = 'ZCL_APC_STORE_TARGET' ).
    lo_json = zcl_ajson=>parse( ls_answer-json ).
    mv_operation = lo_json->get_string( '/op_id' ).
    lo_message = mo_messages->create_message( ).
    lo_message->set_text( ls_answer-json ).
    mo_messages->send( lo_message ).
    lo_timer = cl_abap_timer_manager=>get_timer_manager( ).
    lo_timer->start_timer( i_timer_handler = me i_timeout = 0 ).
  ENDMETHOD.

  METHOD if_abap_timer_handler~on_timeout.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    ls_answer = zcl_osd_adt_host=>store( iv_command = 'ACTIVATION_STATUS'
      iv_json = |\{"op_id":"{ mv_operation }"\}| ).
    lo_message = mo_messages->create_message( ).
    lo_message->set_text( ls_answer-json ).
    mo_messages->send( lo_message ).
  ENDMETHOD.
ENDCLASS.
