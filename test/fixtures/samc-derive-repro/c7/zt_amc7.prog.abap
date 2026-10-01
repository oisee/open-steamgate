REPORT zt_amc7.
CONSTANTS co_ch TYPE string VALUE '/y'.
CLASS lcl DEFINITION.
  PUBLIC SECTION.
    CONSTANTS co_ch TYPE string VALUE '/x'.
    METHODS m.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD m.
  ENDMETHOD.
ENDCLASS.
START-OF-SELECTION.
  DATA lo_p TYPE REF TO if_amc_message_producer_text.
  lo_p ?= cl_amc_channel_manager=>create_message_producer( i_application_id = 'APP' i_channel_id = co_ch ).
