CLASS zcl_adt_initialcs DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_initialcs IMPLEMENTATION.
 METHOD run.
 TYPES ty TYPE c LENGTH 3.
 DATA c TYPE ty.
 DATA lt TYPE STANDARD TABLE OF ty WITH EMPTY KEY.
 DATA n TYPE i.
 IF c CS ` ` OR c NS `` OR c NS ' ' OR c NA ` ` OR c NP ' '.
 cl_abap_unit_assert=>fail( ).
 ENDIF.
 IF c NS ` ` AND c CA ` ` AND c CA ' ' AND c NA `` AND c CP `*` AND c NP `X`.
 ELSE.
 cl_abap_unit_assert=>fail( ).
 ENDIF.
 APPEND c TO lt.
 LOOP AT lt INTO c WHERE table_line CS ` `.
 cl_abap_unit_assert=>fail( ).
 ENDLOOP.
 LOOP AT lt INTO c WHERE table_line NS ` `.
 n = n + 1.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = n exp = 1 ).
 c = 'A'.
 IF c CS `A `.
 ELSE.
 cl_abap_unit_assert=>fail( ).
 ENDIF.
 CLEAR lt.
 APPEND c TO lt.
 n = 0.
 LOOP AT lt INTO c WHERE table_line CS `A `.
 n = n + 1.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = n exp = 1 ).
 ENDMETHOD.
ENDCLASS.
