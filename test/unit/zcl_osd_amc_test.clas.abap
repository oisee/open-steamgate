CLASS zcl_osd_amc_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS send_many IMPORTING iv_count TYPE i RAISING cx_amc_error.
ENDCLASS.

CLASS zcl_osd_amc_test IMPLEMENTATION.
  METHOD send_many.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    DATA lv_number TYPE string.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    DO iv_count TIMES.
      lv_number = sy-index.
      lo_producer->send( lv_number ).
    ENDDO.
  ENDMETHOD.
ENDCLASS.
