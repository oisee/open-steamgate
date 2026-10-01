CLASS zcl_t_amc4 DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
  INTERFACES if_amc_message_receiver_text.
  DATA mo_c TYPE REF TO if_amc_message_consumer.
  METHODS a.
  METHODS b.
ENDCLASS.
CLASS zcl_t_amc4 IMPLEMENTATION.
 METHOD a.
  mo_c = cl_amc_channel_manager=>create_message_consumer( i_application_id = 'APP' i_channel_id = '/a' ).
 ENDMETHOD.
 METHOD b.
  mo_c->start_message_delivery( me ).
 ENDMETHOD.
 METHOD if_amc_message_receiver_text~receive.
 ENDMETHOD.
ENDCLASS.
