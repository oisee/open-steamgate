CLASS ltcl_stg_icf_demo DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS marker_is_nonempty FOR TESTING.

ENDCLASS.

CLASS ltcl_stg_icf_demo IMPLEMENTATION.

  METHOD marker_is_nonempty.
    DATA lv_marker TYPE string.

    lv_marker = zcl_stg_icf_demo=>marker( ).
    cl_abap_unit_assert=>assert_not_initial(
      act = lv_marker
      msg = 'W2 runtime marker must not be empty' ).
  ENDMETHOD.

ENDCLASS.
