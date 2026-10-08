CLASS zcl_adt_message DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
 CLASS-METHODS fail EXCEPTIONS foreign_lock.
ENDCLASS.
CLASS zcl_adt_message IMPLEMENTATION.
 METHOD fail.
 MESSAGE ID '00' TYPE 'E' NUMBER '001' WITH 'one' 'two' 'three' 'four' RAISING foreign_lock.
 ENDMETHOD.
 METHOD run.
 fail( EXCEPTIONS foreign_lock = 1 OTHERS = 2 ).
 cl_abap_unit_assert=>assert_subrc( exp = 1 ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgid exp = '00' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgno exp = '001' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgty exp = 'E' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgv1 exp = 'one' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgv2 exp = 'two' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgv3 exp = 'three' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgv4 exp = 'four' ).
 CALL FUNCTION 'ZADT_PROBE_LOCK' EXCEPTIONS foreign_lock = 1 OTHERS = 2.
 cl_abap_unit_assert=>assert_subrc( exp = 1 ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgid exp = '00' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgno exp = '002' ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgv1 exp = 'fm' ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgv2 ).
 CALL FUNCTION 'ZADT_PROBE_LOCK' EXCEPTIONS OTHERS = 2.
 cl_abap_unit_assert=>assert_subrc( exp = 2 ).
 ENDMETHOD.
ENDCLASS.
