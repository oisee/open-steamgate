CLASS zcl_t_amc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
  CONSTANTS co_ch TYPE string VALUE '/global'.
  METHODS a.
ENDCLASS.
CLASS zcl_t_amc IMPLEMENTATION.
 METHOD a.
  DATA lo_p TYPE REF TO if_amc_message_producer_text.
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'APP' i_channel_id = zcl_t_amc=>co_ch ).
 ENDMETHOD.
ENDCLASS.
