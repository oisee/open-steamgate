CLASS zcl_adt_zeroexc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS status EXCEPTIONS failed.
 CLASS-METHODS raise_it EXCEPTIONS failed.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_zeroexc IMPLEMENTATION.
 METHOD status.
 MESSAGE s001(00) RAISING failed.
 cl_abap_unit_assert=>fail( ).
 ENDMETHOD.
 METHOD raise_it.
 RAISE failed.
 cl_abap_unit_assert=>fail( ).
 ENDMETHOD.
 METHOD run.
 status( EXCEPTIONS OTHERS = 0 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 status( EXCEPTIONS failed = 0 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 raise_it( EXCEPTIONS OTHERS = 0 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 raise_it( EXCEPTIONS failed = 0 ).
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 CALL FUNCTION 'ZADT_PROBE_LOCK' EXCEPTIONS OTHERS = 0.
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 CALL FUNCTION 'ZADT_PROBE_LOCK' EXCEPTIONS foreign_lock = 0.
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 ENDMETHOD.
ENDCLASS.
