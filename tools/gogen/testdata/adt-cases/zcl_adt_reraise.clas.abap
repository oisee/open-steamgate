CLASS zcl_adt_reraise DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_reraise IMPLEMENTATION.
 METHOD run.
 DATA lx TYPE REF TO cx_root.
 DATA lx2 TYPE REF TO cx_sy_zerodivide.
 TRY.
 RAISE EXCEPTION TYPE cx_sy_zerodivide.
 CATCH cx_root INTO lx.
 ENDTRY.
 TRY.
 IF lx IS BOUND.
 RAISE EXCEPTION lx.
 ENDIF.
 CATCH cx_sy_zerodivide INTO lx2.
 ENDTRY.
 cl_abap_unit_assert=>assert_bound( act = lx2 ).
 cl_abap_unit_assert=>assert_true( act = boolc( lx2 = lx ) ).
 DATA lo TYPE REF TO object.
 CREATE OBJECT lo TYPE cx_sy_zerodivide.
 TRY.
 RAISE EXCEPTION lo.
 CATCH cx_sy_zerodivide INTO lx2.
 ENDTRY.
 cl_abap_unit_assert=>assert_true( act = boolc( lx2 = lo ) ).
 ENDMETHOD.
ENDCLASS.
