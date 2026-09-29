CLASS zcl_osd_amc_socket DEFINITION PUBLIC INHERITING FROM cl_apc_wsp_ext_stateless_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
ENDCLASS.

CLASS zcl_osd_amc_socket IMPLEMENTATION.
  METHOD if_apc_wsp_extension~on_start.
    DATA lo_binding TYPE REF TO if_apc_wsp_binding_manager.
    lo_binding = i_context->get_binding_manager( ).
    lo_binding->bind_amc_message_consumer(
      i_application_id = 'ZOSD_AMC_TEST'
      i_channel_id = '/text' ).
  ENDMETHOD.
ENDCLASS.
