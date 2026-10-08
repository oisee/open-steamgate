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
 DATA back TYPE timestamp.
 CONVERT DATE d TIME t INTO TIME STAMP back TIME ZONE ''.
 cl_abap_unit_assert=>assert_equals( act = back exp = ts ).
 ENDMETHOD.
ENDCLASS.
