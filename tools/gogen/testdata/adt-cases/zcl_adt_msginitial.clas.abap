CLASS zcl_adt_msginitial DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_msginitial IMPLEMENTATION.
 METHOD run.
 cl_abap_unit_assert=>assert_equals( act = sy-msgno exp = `000` ).
 DATA result TYPE string.
 result = sy-msgno.
 cl_abap_unit_assert=>assert_equals( act = result exp = `000` ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgid ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgty ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgv1 ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgv2 ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgv3 ).
 cl_abap_unit_assert=>assert_initial( act = sy-msgv4 ).
 ENDMETHOD.
ENDCLASS.
