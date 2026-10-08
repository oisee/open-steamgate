CLASS zcl_adt_alias DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 INTERFACES zif_adt_alias.
 ALIASES send FOR zif_adt_alias~status.
 ALIASES raise_it FOR zif_adt_alias~plain.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_alias IMPLEMENTATION.
 METHOD zif_adt_alias~status.
 MESSAGE s001(00) RAISING failed.
 cl_abap_unit_assert=>fail( ).
 ENDMETHOD.
 METHOD zif_adt_alias~plain.
 RAISE failed.
 ENDMETHOD.
 METHOD run.
 DATA lo TYPE REF TO zcl_adt_alias.
 DATA li TYPE REF TO zif_adt_alias.
 CREATE OBJECT lo.
 li = lo.
 lo->send( EXCEPTIONS failed = 1 ).
 cl_abap_unit_assert=>assert_subrc( exp = 1 ).
 lo->zif_adt_alias~status( EXCEPTIONS failed = 2 ).
 cl_abap_unit_assert=>assert_subrc( exp = 2 ).
 li->status( EXCEPTIONS failed = 3 ).
 cl_abap_unit_assert=>assert_subrc( exp = 3 ).
 lo->raise_it( EXCEPTIONS failed = 4 ).
 cl_abap_unit_assert=>assert_subrc( exp = 4 ).
 ENDMETHOD.
ENDCLASS.
