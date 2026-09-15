CLASS ltcl_ztest_demo DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS greeting_passes FOR TESTING.
    METHODS deliberate_failure FOR TESTING.

ENDCLASS.

CLASS ltcl_ztest_demo IMPLEMENTATION.

  METHOD greeting_passes.
    DATA lo_cut TYPE REF TO zcl_ztest_demo.
    DATA lv_text TYPE string.

    CREATE OBJECT lo_cut.
    lv_text = lo_cut->zif_ztest_greeter~greet( 'Ada' ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_text
      exp = 'Hello Ada' ).

    lv_text = zcl_ztest_demo=>status_text( 'O' ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_text
      exp = 'Open' ).
  ENDMETHOD.

  METHOD deliberate_failure.
* This method fails on purpose. A test run that reports only passes says
* nothing about whether a failure ever reaches the client, so the demo
* package carries one failure whose text names itself.
    DATA lv_text TYPE string.

    lv_text = zcl_ztest_demo=>status_text( 'C' ).
    cl_abap_unit_assert=>assert_equals(
      act = lv_text
      exp = 'Open'
      msg = 'ZTEST: this assertion fails on purpose' ).
  ENDMETHOD.

ENDCLASS.
