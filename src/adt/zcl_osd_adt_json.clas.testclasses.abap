CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS strings FOR TESTING RAISING cx_static_check.
    METHODS ordered FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD strings.
    DATA lv_text TYPE string.
    lv_text = cl_abap_codepage=>convert_from( '00011F' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_json=>quote( lv_text ) exp = `"\u0000\u0001\u001f"` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_json=>quote( `a"\` ) exp = `"a\"\\"` ).
  ENDMETHOD.
  METHOD ordered.
    DATA lo_json TYPE REF TO zcl_osd_adt_json.
    CREATE OBJECT lo_json.
    lo_json->add( iv_name = `z` iv_value = `first` ).
    lo_json->add_raw( iv_name = `a` iv_json = `[]` ).
    cl_abap_unit_assert=>assert_equals( act = lo_json->document( ) exp = `{"z":"first","a":[]}` ).
  ENDMETHOD.
ENDCLASS.
