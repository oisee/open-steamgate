CLASS ltcl_amc DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PUBLIC SECTION.
    INTERFACES if_amc_message_receiver_text.
    INTERFACES if_amc_message_receiver_binary.
    INTERFACES if_amc_message_receiver_pcp.
  PRIVATE SECTION.
    DATA mo_consumer TYPE REF TO if_amc_message_consumer.
    DATA mv_count TYPE i.
    DATA mv_binary TYPE xstring.
    DATA mo_pcp TYPE REF TO if_ac_message_type_pcp.
    DATA mv_client TYPE string.
    DATA mv_username TYPE string.
    METHODS setup.
    METHODS teardown.
    METHODS producer_consumer FOR TESTING.
    METHODS echo_suppression FOR TESTING.
    METHODS rollback_keeps_message FOR TESTING.
    METHODS unauthorised_send FOR TESTING.
    METHODS binary_delivery FOR TESTING.
    METHODS pcp_delivery FOR TESTING.
    METHODS session_id_is_stable FOR TESTING.
    METHODS synchronous_is_refused FOR TESTING.
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
    mv_client = i_context->get_producer_client( ).
    mv_username = i_context->get_producer_username( ).
  ENDMETHOD.

  METHOD if_amc_message_receiver_binary~receive.
    ADD 1 TO mv_count.
    mv_binary = i_message.
  ENDMETHOD.

  METHOD if_amc_message_receiver_pcp~receive.
    ADD 1 TO mv_count.
    mo_pcp = i_message.
  ENDMETHOD.

  METHOD producer_consumer.
    DATA lo_producer TYPE REF TO if_amc_message_producer_text.
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text' ).
    lo_producer->send( 'one' ).
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_equals( act = mv_count exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = mv_client exp = sy-mandt ).
    cl_abap_unit_assert=>assert_equals( act = mv_username exp = sy-uname ).
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

  METHOD binary_delivery.
    DATA lo_consumer TYPE REF TO if_amc_message_consumer.
    DATA lo_producer TYPE REF TO if_amc_message_producer_binary.
    DATA lv_message TYPE xstring.
    lo_consumer = cl_amc_channel_manager=>create_message_consumer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/binary' ).
    lo_consumer->start_message_delivery( me ).
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/binary' ).
    lv_message = 'DEADBEEF'.
    lo_producer->send( lv_message ).
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_equals( act = mv_binary exp = lv_message ).
    lo_consumer->stop_message_delivery( me ).
  ENDMETHOD.

  METHOD pcp_delivery.
    DATA lo_consumer TYPE REF TO if_amc_message_consumer.
    DATA lo_producer TYPE REF TO if_amc_message_producer_pcp.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    lo_consumer = cl_amc_channel_manager=>create_message_consumer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/pcp' ).
    lo_consumer->start_message_delivery( me ).
    lo_producer ?= cl_amc_channel_manager=>create_message_producer(
      i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/pcp' ).
    lo_message = cl_ac_message_type_pcp=>create( ).
    lo_message->set_text( 'pcp body' ).
    lo_producer->send( lo_message ).
    WAIT FOR MESSAGING CHANNELS UNTIL mv_count = 1 UP TO 1 SECONDS.
    cl_abap_unit_assert=>assert_bound( mo_pcp ).
    cl_abap_unit_assert=>assert_equals( act = mo_pcp->get_text( ) exp = 'pcp body' ).
    lo_consumer->stop_message_delivery( me ).
  ENDMETHOD.

  METHOD session_id_is_stable.
    DATA lv_first TYPE string.
    DATA lv_second TYPE string.
    lv_first = cl_amc_channel_manager=>get_consumer_session_id( ).
    lv_second = cl_amc_channel_manager=>get_consumer_session_id( ).
    cl_abap_unit_assert=>assert_not_initial( lv_first ).
    cl_abap_unit_assert=>assert_equals( act = lv_first exp = lv_second ).
  ENDMETHOD.

  METHOD synchronous_is_refused.
    DATA lo_error TYPE REF TO cx_amc_error.
    DATA lo_producer TYPE REF TO if_amc_message_producer.
    TRY.
        lo_producer = cl_amc_channel_manager=>create_message_producer(
          i_application_id = 'ZOSD_AMC_TEST' i_channel_id = '/text'
          i_communication_type = cl_amc_channel_manager=>co_comm_type_synchronous ).
        cl_abap_unit_assert=>fail( 'Synchronous AMC was accepted' ).
      CATCH cx_amc_error INTO lo_error.
        cl_abap_unit_assert=>assert_equals(
          act = lo_error->get_text( ) exp = 'Communication type 1 is not supported.' ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
