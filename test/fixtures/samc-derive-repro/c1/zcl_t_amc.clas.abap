CLASS zcl_t_amc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
  METHODS a.
  METHODS b.
ENDCLASS.
CLASS zcl_t_amc IMPLEMENTATION.
 METHOD a.
  CONSTANTS lc_ch TYPE string VALUE '/a'.
  DATA lo_p TYPE REF TO if_amc_message_producer_text.
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'APP' i_channel_id = lc_ch ).
 ENDMETHOD.
 METHOD b.
  CONSTANTS lc_ch TYPE string VALUE '/b'.
  DATA lo_p TYPE REF TO if_amc_message_producer_text.
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'APP' i_channel_id = lc_ch ).
 ENDMETHOD.
ENDCLASS.
