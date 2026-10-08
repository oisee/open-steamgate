CLASS zcl_adt_timestamp DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_timestamp IMPLEMENTATION.
 METHOD run.
 DATA ts TYPE timestamp VALUE '20261007231500'.
 DATA d TYPE d.
 DATA t TYPE t.
 CONVERT TIME STAMP ts TIME ZONE 'UTC' INTO DATE d TIME t.
 cl_abap_unit_assert=>assert_equals( act = d exp = '20261007' ).
 cl_abap_unit_assert=>assert_equals( act = t exp = '231500' ).
 DATA saved TYPE timestamp VALUE '20261007231500'.
 DATA invalid_d TYPE d.
 DATA invalid_t TYPE t.
 CONVERT DATE invalid_d TIME invalid_t INTO TIME STAMP saved TIME ZONE 'UTC'.
 cl_abap_unit_assert=>assert_subrc( exp = 12 ).
 cl_abap_unit_assert=>assert_equals( act = saved exp = ts ).
 invalid_d = '20260230'.
 CONVERT DATE invalid_d TIME invalid_t INTO TIME STAMP saved TIME ZONE 'UTC'.
 cl_abap_unit_assert=>assert_subrc( exp = 12 ).
 cl_abap_unit_assert=>assert_equals( act = saved exp = ts ).
 invalid_d = '20261007'.
 invalid_t = '240000'.
 CONVERT DATE invalid_d TIME invalid_t INTO TIME STAMP saved TIME ZONE 'UTC'.
 cl_abap_unit_assert=>assert_subrc( exp = 12 ).
 cl_abap_unit_assert=>assert_equals( act = saved exp = ts ).
 saved = 0.
 CONVERT TIME STAMP saved TIME ZONE 'UTC' INTO DATE d TIME t.
 cl_abap_unit_assert=>assert_subrc( exp = 12 ).
 cl_abap_unit_assert=>assert_equals( act = d exp = '20261007' ).
 cl_abap_unit_assert=>assert_equals( act = t exp = '231500' ).
 DATA back TYPE timestamp.
 CONVERT DATE d TIME t INTO TIME STAMP back TIME ZONE ''.
 cl_abap_unit_assert=>assert_equals( act = back exp = ts ).
 ENDMETHOD.
ENDCLASS.
