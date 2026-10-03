CLASS ltcl_classrun DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS source_decision FOR TESTING.
ENDCLASS.
CLASS ltcl_classrun IMPLEMENTATION.
  METHOD source_decision.
    cl_abap_unit_assert=>assert_equals( exp = abap_true
      act = zcl_osd_adt_classrun=>supports( `  InTeRfAcEs if_oo_adt_classrun.` ) ).
    cl_abap_unit_assert=>assert_equals( exp = abap_true
      act = zcl_osd_adt_classrun=>supports( `CLASS x.` && cl_abap_char_utilities=>cr_lf
        && cl_abap_char_utilities=>horizontal_tab && `INTERFACES if_oo_adt_classrun.` ) ).
    cl_abap_unit_assert=>assert_equals( exp = abap_false
      act = zcl_osd_adt_classrun=>supports( `* INTERFACES if_oo_adt_classrun.` ) ).
    cl_abap_unit_assert=>assert_equals( exp = abap_false
      act = zcl_osd_adt_classrun=>supports( `INTERFACES if_oo_adt_classrun_out.` ) ).
    cl_abap_unit_assert=>assert_equals( exp = abap_false
      act = zcl_osd_adt_classrun=>supports( `CLASS x INHERITING FROM y.` ) ).
  ENDMETHOD.
ENDCLASS.
