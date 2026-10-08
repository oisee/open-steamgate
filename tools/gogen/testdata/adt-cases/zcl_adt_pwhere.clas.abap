CLASS zcl_adt_pwhere DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_pwhere IMPLEMENTATION.
 METHOD run.
 DATA lt TYPE STANDARD TABLE OF zadt_pwhere WITH DEFAULT KEY.
 DATA ls TYPE zadt_pwhere.
 DATA lv_cutoff TYPE timestamp VALUE '20261008100000'.
 DATA lv_plm TYPE tzntstmpl VALUE '20261008100000.1234567'.
 DATA lv_i TYPE i VALUE 0.
 DATA lv_int8 TYPE int8 VALUE 20261008100000.
 DATA lv_count TYPE i.
 DELETE FROM zadt_pwhere.
 ls-id = 'A'. ls-ts = '20261008099999'. ls-tstmp = '20261008100000.0000000'. APPEND ls TO lt.
 ls-id = 'B'. ls-ts = '20261008100000'. ls-tstmp = '20261008100000.1234567'. APPEND ls TO lt.
 ls-id = 'C'. ls-ts = '20261008100001'. ls-tstmp = '20261008100000.9999999'. APPEND ls TO lt.
 ls-id = 'D'. ls-ts = '0'. ls-tstmp = '0'. APPEND ls TO lt.
 INSERT zadt_pwhere FROM TABLE lt.
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE ts < lv_cutoff.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 2 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE ts >= lv_cutoff.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 2 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE ts = lv_i.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE ts = 20261008100000.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE tstmp = lv_int8.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE tstmp BETWEEN lv_plm AND lv_plm.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
 SELECT COUNT(*) FROM zadt_pwhere INTO lv_count WHERE tstmp <> lv_plm.
 cl_abap_unit_assert=>assert_equals( act = lv_count exp = 3 ).
 DELETE FROM zadt_pwhere.
 ENDMETHOD.
ENDCLASS.
