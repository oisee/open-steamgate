CLASS ltcl_object DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS reports FOR TESTING.
    METHODS entities FOR TESTING.
ENDCLASS.
CLASS ltcl_object IMPLEMENTATION.
  METHOD reports.
    DATA lv_source TYPE string.
    lv_source = cl_abap_codepage=>convert_from( 'EFBBBFC2A0' ) && `report z.`.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>report_source( lv_source ) exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>report_source( `reports z.` ) exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>report_source( `* report z.` ) exp = abap_false ).
  ENDMETHOD.
  METHOD entities.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>view_entity( |DEFINE\nroot\tview entity z| ) exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>view_entity( `define view entity2` ) exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>view_entity( `define,view entity` ) exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_object=>view_entity( `redefine view entity` ) exp = abap_false ).
  ENDMETHOD.
ENDCLASS.
