CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS basic FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD basic.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_user=>from_basic( `bAsIc ZGVtbzpwYXNz` ) exp = `DEMO` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_user=>from_basic( `Basic OnBhc3M=` ) exp = `DEVELOPER` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_user=>from_basic( `Bearer anything` ) exp = `DEVELOPER` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_user=>from_basic( iv_header = `` iv_default = `OTHER` ) exp = `OTHER` ).
  ENDMETHOD.
ENDCLASS.
