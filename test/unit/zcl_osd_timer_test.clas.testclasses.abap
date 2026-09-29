CLASS ltcl_timer DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS outside_session FOR TESTING.
ENDCLASS.

CLASS ltcl_timer IMPLEMENTATION.
  METHOD outside_session.
    DATA lo_manager TYPE REF TO if_abap_timer_manager.
    DATA lo_error TYPE REF TO cx_abap_timer_error.
    TRY.
        lo_manager = cl_abap_timer_manager=>get_timer_manager( ).
        cl_abap_unit_assert=>fail( 'timer manager outside APC session' ).
      CATCH cx_abap_timer_error INTO lo_error.
        cl_abap_unit_assert=>assert_equals(
          act = lo_error->textid exp = cx_abap_timer_error=>session_type_not_supported ).
        cl_abap_unit_assert=>assert_equals(
          act = lo_error->get_text( ) exp = 'Session type is not supported.' ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
