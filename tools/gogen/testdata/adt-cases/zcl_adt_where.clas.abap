CLASS zcl_adt_where DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_where IMPLEMENTATION.
 METHOD run.
 DATA lt TYPE STANDARD TABLE OF string WITH EMPTY KEY.
 DATA found TYPE string.
 lt = VALUE #( ( `/sap/bc/adt/x` ) ( `/other` ) ).
 LOOP AT lt INTO DATA(lv) WHERE table_line NP `/sap/bc/adt*`.
 found = found && lv.
 ENDLOOP.
 cl_abap_unit_assert=>assert_equals( act = found exp = `/other` ).
 LOOP AT lt INTO lv WHERE table_line CP `/sap/bc/adt*` AND table_line CS `ADT` AND table_line CA `x` AND table_line NA `Z` AND table_line NS `other`.
 cl_abap_unit_assert=>assert_equals( act = lv exp = `/sap/bc/adt/x` ).
 ENDLOOP.
 cl_abap_unit_assert=>assert_subrc( exp = 0 ).
 ENDMETHOD.
ENDCLASS.
