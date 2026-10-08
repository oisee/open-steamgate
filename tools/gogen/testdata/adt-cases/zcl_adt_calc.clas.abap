CLASS zcl_adt_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_calc IMPLEMENTATION.
 METHOD run.
 DATA d TYPE d VALUE '20261007'.
 DATA epoch TYPE d VALUE '19700101'.
 DATA days TYPE p LENGTH 8 DECIMALS 0.
 days = d - epoch.
 cl_abap_unit_assert=>assert_equals( act = days exp = 20733 ).
 DATA t TYPE t VALUE '231500'.
 DATA midnight TYPE t VALUE '000000'.
 DATA seconds TYPE i.
 seconds = t - midnight.
 cl_abap_unit_assert=>assert_equals( act = seconds exp = 83700 ).
 DATA lt TYPE STANDARD TABLE OF string WITH EMPTY KEY.
 APPEND `x` TO lt.
 DATA n TYPE i.
 n = lines( lt ) + 1.
 cl_abap_unit_assert=>assert_equals( act = n exp = 2 ).
 DATA c TYPE c LENGTH 10.
 c = n - 1 + 1.
 cl_abap_unit_assert=>assert_equals( act = c exp = '        2 ' ).
 DATA num6 TYPE n LENGTH 6.
 DATA rows TYPE STANDARD TABLE OF string WITH EMPTY KEY.
 num6 = lines( rows ) + 1.
 cl_abap_unit_assert=>assert_equals( act = num6 exp = '000001' ).
 DO 5 TIMES. APPEND `x` TO rows. ENDDO.
 num6 = lines( rows ) + 1.
 cl_abap_unit_assert=>assert_equals( act = num6 exp = '000006' ).
 DATA num2 TYPE n LENGTH 2.
 CLEAR rows.
 DO 100 TIMES. APPEND `x` TO rows. ENDDO.
 num2 = lines( rows ) + 1.
 cl_abap_unit_assert=>assert_equals( act = num2 exp = '01' ).
 DATA text TYPE string.
 CLEAR rows.
 DO 5 TIMES. APPEND `x` TO rows. ENDDO.
 text = lines( rows ) + 1.
 cl_abap_unit_assert=>assert_equals( act = text exp = '6' ).
 n = -2.
 c = n - 1 + 1.
 cl_abap_unit_assert=>assert_equals( act = c exp = '        2-' ).
 ENDMETHOD.
ENDCLASS.
