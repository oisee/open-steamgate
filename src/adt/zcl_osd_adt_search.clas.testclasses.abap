CLASS ltcl_search DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS package_slice FOR TESTING.
    METHODS patterns FOR TESTING.
ENDCLASS.
CLASS ltcl_search IMPLEMENTATION.
  METHOD package_slice.
    DATA ls_max TYPE zcl_osd_adt_js=>ty_number.
    ls_max = zcl_osd_adt_js=>number( `2.5` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_search=>slice_end( is_max = ls_max iv_length = 5 ) exp = 2 ).
    ls_max = zcl_osd_adt_js=>number( `-1` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_search=>slice_end( is_max = ls_max iv_length = 5 ) exp = 4 ).
    ls_max = zcl_osd_adt_js=>number( `abc` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_search=>slice_end( is_max = ls_max iv_length = 5 ) exp = 0 ).
    ls_max = zcl_osd_adt_js=>number( `Infinity` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_search=>slice_end( is_max = ls_max iv_length = 5 ) exp = 5 ).
  ENDMETHOD.
  METHOD patterns.
    cl_abap_unit_assert=>assert_true( zcl_osd_adt_search=>matches( iv_name = `ZCL_TEST` iv_pattern = `CL` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_search=>matches( iv_name = `ZCL_TEST` iv_pattern = `CL*` ) ).
    cl_abap_unit_assert=>assert_true( zcl_osd_adt_search=>matches( iv_name = `ZCL_TEST` iv_pattern = `Z*T` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_search=>matches( iv_name = `ZCL_TEST` iv_pattern = `Z+T` ) ).
  ENDMETHOD.
ENDCLASS.
