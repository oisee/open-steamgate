CLASS zcl_osd_amc_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS send_many IMPORTING iv_count TYPE i RAISING cx_amc_error.
    INTERFACES if_amc_message_receiver_text.
    METHODS wait_up_to RETURNING VALUE(rv_count) TYPE i RAISING cx_amc_error.
  PRIVATE SECTION.
    DATA mv_count TYPE i.
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

  METHOD wait_up_to.
    DATA lo_consumer TYPE REF TO if_amc_message_consumer.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    lo_consumer = cl_amc_channel_manager=>create_message_consumer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    lo_consumer->start_message_delivery( me ).
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    lo_producer->send( 'plain wait' ).
    WAIT UP TO '0.2' SECONDS.
    rv_count = mv_count.
    lo_consumer->stop_message_delivery( me ).
  ENDMETHOD.

  METHOD if_amc_message_receiver_text~receive.
    ADD 1 TO mv_count.
  ENDMETHOD.
ENDCLASS.
