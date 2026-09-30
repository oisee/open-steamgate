CLASS ltcl_lifecycle DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-DATA gv_state TYPE i.
    CLASS-METHODS class_setup.
    CLASS-METHODS class_teardown.
    METHODS setup.
    METHODS teardown.
    METHODS pass FOR TESTING.
    METHODS fail FOR TESTING.
    METHODS exception FOR TESTING.
    METHODS after_failure FOR TESTING.
ENDCLASS.

CLASS ltcl_teardown_conditional DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-DATA gv_count TYPE i.
    METHODS teardown.
    METHODS first FOR TESTING.
    METHODS second FOR TESTING.
    METHODS third FOR TESTING.
ENDCLASS.
CLASS ltcl_teardown_conditional IMPLEMENTATION.
  METHOD first.
    gv_count = 1.
  ENDMETHOD.
  METHOD second.
    gv_count = 2.
  ENDMETHOD.
  METHOD third.
    cl_abap_unit_assert=>fail( 'third must be skipped' ).
  ENDMETHOD.
  METHOD teardown.
    IF gv_count = 1.
      cl_abap_unit_assert=>fail( msg = 'continue first' quit = if_aunit_constants=>quit-no ).
    ELSEIF gv_count = 2.
      cl_abap_unit_assert=>fail( 'stop second' ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_lifecycle IMPLEMENTATION.
  METHOD class_setup.
    gv_state = 1.
  ENDMETHOD.
  METHOD setup.
    gv_state = gv_state + 1.
  ENDMETHOD.
  METHOD teardown.
    gv_state = gv_state + 1.
  ENDMETHOD.
  METHOD pass.
    IF gv_state <> 2.
      cl_abap_unit_assert=>fail( 'setup order' ).
    ENDIF.
  ENDMETHOD.
  METHOD fail.
    cl_abap_unit_assert=>fail( 'intentional failure' ).
  ENDMETHOD.
  METHOD exception.
    DATA lv_zero TYPE i.
    DATA lv_result TYPE i.
    lv_result = 1 / lv_zero.
  ENDMETHOD.
  METHOD after_failure.
    IF gv_state <> 8.
      cl_abap_unit_assert=>fail( 'teardown order' ).
    ENDIF.
  ENDMETHOD.
  METHOD class_teardown.
    IF gv_state <> 9.
      cl_abap_unit_assert=>fail( 'class_teardown order' ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_teardown_stop DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-DATA gv_count TYPE i.
    METHODS teardown.
    METHODS first FOR TESTING.
    METHODS second FOR TESTING.
ENDCLASS.
CLASS ltcl_teardown_stop IMPLEMENTATION.
  METHOD first.
    gv_count = gv_count + 1.
  ENDMETHOD.
  METHOD second.
    gv_count = gv_count + 1.
  ENDMETHOD.
  METHOD teardown.
    IF gv_count = 1.
      cl_abap_unit_assert=>fail( 'teardown stop' ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS ltcl_teardown_continue DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CLASS-DATA gv_count TYPE i.
    METHODS teardown.
    METHODS first FOR TESTING.
    METHODS second FOR TESTING.
ENDCLASS.
CLASS ltcl_teardown_continue IMPLEMENTATION.
  METHOD first.
    gv_count = gv_count + 1.
  ENDMETHOD.
  METHOD second.
    IF gv_count <> 1.
      cl_abap_unit_assert=>fail( 'second did not run' ).
    ENDIF.
    gv_count = gv_count + 1.
  ENDMETHOD.
  METHOD teardown.
    IF gv_count = 1.
      cl_abap_unit_assert=>fail( msg = 'teardown continue' quit = if_aunit_constants=>quit-no ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
