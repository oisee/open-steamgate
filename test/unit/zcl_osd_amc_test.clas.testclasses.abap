CLASS ltcl_amc DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PUBLIC SECTION.
    INTERFACES if_amc_message_receiver_text.
  PRIVATE SECTION.
    DATA mo_consumer TYPE REF TO if_amc_message_consumer.
    DATA mv_count TYPE i.
    METHODS setup.
    METHODS teardown.
    METHODS producer_consumer FOR TESTING.
    METHODS echo_suppression FOR TESTING.
    METHODS rollback_keeps_message FOR TESTING.
    METHODS unauthorised_send FOR TESTING.
ENDCLASS.

CLASS ltcl_amc IMPLEMENTATION.
  METHOD setup.
    mo_consumer = cl_amc_channel_manager=>create_message_consumer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    mo_consumer->start_message_delivery( me ).
  ENDMETHOD.

  METHOD teardown.
    mo_consumer->stop_message_delivery( me ).
  ENDMETHOD.

  METHOD if_amc_message_receiver_text~receive.
    ADD 1 TO mv_count.
  ENDMETHOD.

  METHOD producer_consumer.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    lo_producer->send( 'one' ).
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_equals( act = mv_count exp = 1 ).
  ENDMETHOD.

  METHOD echo_suppression.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text'
      i_suppress_echo = abap_true ).
    lo_producer->send( 'quiet' ).
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_equals( act = mv_count exp = 0 ).
  ENDMETHOD.

  METHOD rollback_keeps_message.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    lo_producer->send( 'before rollback' ).
    ROLLBACK WORK.
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_equals( act = mv_count exp = 1 ).
  ENDMETHOD.

  METHOD unauthorised_send.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    DATA lo_error TYPE REF TO cx_amc_error.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/denied' ).
    TRY.
        lo_producer->send( 'denied' ).
        cl_abap_unit_assert=>fail( 'An unauthorised SEND was accepted' ).
      CATCH cx_amc_error INTO lo_error.
        cl_abap_unit_assert=>assert_not_initial( lo_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
