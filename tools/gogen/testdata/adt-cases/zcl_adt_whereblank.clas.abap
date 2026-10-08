CLASS zcl_adt_whereblank DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_whereblank IMPLEMENTATION.
 METHOD run.
 TYPES ty TYPE c LENGTH 3.
 DATA lt TYPE STANDARD TABLE OF ty WITH EMPTY KEY.
 DATA pattern TYPE c LENGTH 3 VALUE 'A# '.
 DATA n TYPE i.
 APPEND 'A' TO lt.
 LOOP AT lt INTO DATA(lv) WHERE table_line CS `A `.
 n = n + 1.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = n exp = 1 ).
 n = 0.
 LOOP AT lt INTO lv WHERE table_line CA ` `.
 n = n + 1.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = n exp = 1 ).
 LOOP AT lt INTO lv WHERE table_line NS `A `.
 cl_abap_unit_assert=>fail( ).
 ENDLOOP.
 LOOP AT lt INTO lv WHERE table_line CP pattern.
 n = n + 1.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = n exp = 2 ).
 LOOP AT lt INTO lv WHERE table_line NP pattern.
 cl_abap_unit_assert=>fail( ).
 ENDLOOP.
 IF lv CS `A ` AND lv CA ` ` AND lv CP pattern AND lv CP 'A'.
 ELSE.
 cl_abap_unit_assert=>fail( ).
 ENDIF.
 ENDMETHOD.
ENDCLASS.
