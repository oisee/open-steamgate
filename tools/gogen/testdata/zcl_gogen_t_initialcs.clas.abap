CLASS zcl_gogen_t_initialcs DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_initialcs IMPLEMENTATION.
 METHOD run.
 TYPES ty TYPE c LENGTH 3.
 DATA c TYPE ty.
 DATA lt TYPE STANDARD TABLE OF ty WITH EMPTY KEY.
 DATA n TYPE i.
 IF c CS ` ` OR c NS `` OR c NS ' ' OR c NA ` ` OR c NP ' '.
 ASSERT 1 = 2.
 ENDIF.
 IF c NS ` ` AND c CA ` ` AND c CA ' ' AND c NA `` AND c CP `*` AND c NP `X`.
 ELSE.
 ASSERT 1 = 2.
 ENDIF.
 APPEND c TO lt.
 LOOP AT lt INTO c WHERE table_line CS ` `.
 ASSERT 1 = 2.
 ENDLOOP.
 LOOP AT lt INTO c WHERE table_line NS ` `.
 n = n + 1.
 ENDLOOP.
 ASSERT n = 1.
 c = 'A'.
 IF c CS `A `.
 ELSE.
 ASSERT 1 = 2.
 ENDIF.
 CLEAR lt.
 APPEND c TO lt.
 n = 0.
 LOOP AT lt INTO c WHERE table_line CS `A `.
 n = n + 1.
 ENDLOOP.
 ASSERT n = 1.
 rv = `ok`.
 ENDMETHOD.
ENDCLASS.
