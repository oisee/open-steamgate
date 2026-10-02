CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS strings FOR TESTING RAISING cx_static_check.
    METHODS members FOR TESTING RAISING cx_static_check.
    METHODS ordered FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD members.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_actual TYPE string_table.
    DATA lt_expected TYPE string_table.
    DATA lv_index TYPE string.
    lo_json = zcl_ajson=>parse( iv_json = `{"z":[1,2,3,4,5,6,7,8,9,10,11,12],"a":[],"m":{}}`
      iv_keep_item_order = abap_true ).
    DO 12 TIMES.
      lv_index = sy-index.
      CONDENSE lv_index.
      APPEND lv_index TO lt_expected.
    ENDDO.
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/z` ).
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `z/` ).
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
    CLEAR lt_expected.
    APPEND `z` TO lt_expected.
    APPEND `a` TO lt_expected.
    APPEND `m` TO lt_expected.
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/` ).
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `` ).
    cl_abap_unit_assert=>assert_equals( act = lt_actual exp = lt_expected ).
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/a` ).
    cl_abap_unit_assert=>assert_initial( lt_actual ).
    lt_actual = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/missing` ).
    cl_abap_unit_assert=>assert_initial( lt_actual ).
  ENDMETHOD.
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
