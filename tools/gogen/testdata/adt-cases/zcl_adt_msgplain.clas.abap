CLASS zcl_adt_msgplain DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
 CLASS-METHODS status EXCEPTIONS failed other.
 CLASS-METHODS nested EXCEPTIONS failed.
ENDCLASS.
CLASS zcl_adt_msgplain IMPLEMENTATION.
 METHOD status.
 MESSAGE s001(00) WITH 'status' RAISING failed.
 MESSAGE i002(00) RAISING failed.
 ENDMETHOD.
 METHOD nested.
 status( ).
 ENDMETHOD.
 METHOD run.
 status( ).
 cl_abap_unit_assert=>assert_equals( act = sy-msgty exp = 'I' ).
 status( EXCEPTIONS other = 3 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 nested( EXCEPTIONS failed = 5 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 status( EXCEPTIONS failed = 1 ).
 cl_abap_unit_assert=>assert_subrc( exp = 1 ).
 status( EXCEPTIONS OTHERS = 2 ).
 cl_abap_unit_assert=>assert_subrc( exp = 2 ).
 ENDMETHOD.
ENDCLASS.
