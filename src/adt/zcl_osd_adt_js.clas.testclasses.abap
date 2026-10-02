CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS numbers FOR TESTING RAISING cx_static_check.
    METHODS globs FOR TESTING RAISING cx_static_check.
    METHODS collation FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD numbers.
    DATA ls_number TYPE zcl_osd_adt_js=>ty_number.
    ls_number = zcl_osd_adt_js=>number( ` 0x10 ` ).
    cl_abap_unit_assert=>assert_equals( act = ls_number-value exp = 16 ).
    ls_number = zcl_osd_adt_js=>number( `2oops` ).
    cl_abap_unit_assert=>assert_true( ls_number-nan ).
    ls_number = zcl_osd_adt_js=>js_int( ` -12oops` ).
    cl_abap_unit_assert=>assert_equals( act = ls_number-value exp = -12 ).
    ls_number = zcl_osd_adt_js=>js_int( `0x10z` ).
    cl_abap_unit_assert=>assert_equals( act = ls_number-value exp = 16 ).
  ENDMETHOD.
  METHOD globs.
    cl_abap_unit_assert=>assert_true( zcl_osd_adt_js=>glob( iv_pattern = `Z*X` iv_text = `ZCL_X` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_js=>glob( iv_pattern = `Z+X` iv_text = `ZCL_X` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_adt_js=>glob( iv_pattern = `z*x` iv_text = `ZCL_X` ) ).
    cl_abap_unit_assert=>assert_true( zcl_osd_adt_js=>glob( iv_pattern = `**` iv_text = `` ) ).
  ENDMETHOD.
  METHOD collation.
    DATA lv_a TYPE string.
    DATA lv_b TYPE string.
    lv_a = zcl_osd_adt_js=>collate( `zcl_a` ).
    lv_b = zcl_osd_adt_js=>collate( `ZCL_A` ).
    cl_abap_unit_assert=>assert_true( boolc( lv_a < lv_b ) ).
  ENDMETHOD.
ENDCLASS.
