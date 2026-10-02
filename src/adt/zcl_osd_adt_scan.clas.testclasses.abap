CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS attributes FOR TESTING RAISING cx_static_check.
    METHODS blocks FOR TESTING RAISING cx_static_check.
    METHODS references FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD attributes.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    zcl_osd_adt_scan=>attribute( EXPORTING iv_xml = `<x notadtcore:name="wrong" :adtcore:name=""/>` iv_name = `adtcore:name`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_true( lv_found ).
    cl_abap_unit_assert=>assert_initial( lv_value ).
    zcl_osd_adt_scan=>attribute( EXPORTING iv_xml = `<pack:superPackageExtra adtcore:name="wrong"/><pack:superPackage adtcore:name="right"/>`
      iv_element = `pack:superPackage` iv_name = `adtcore:name`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_equals( act = lv_value exp = `right` ).
  ENDMETHOD.
  METHOD blocks.
    DATA lt_blocks TYPE zcl_osd_adt_scan=>tt_block.
    DATA ls_block TYPE zcl_osd_adt_scan=>ty_block.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    lt_blocks = zcl_osd_adt_scan=>blocks( iv_xml = `<x id="1">first</x><x>second</x>` iv_element = `x` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_blocks ) exp = 2 ).
    READ TABLE lt_blocks INDEX 1 INTO ls_block.
    cl_abap_unit_assert=>assert_equals( act = ls_block-content exp = `first` ).
    zcl_osd_adt_scan=>first_tag_value( EXPORTING iv_xml = `<X>&amp;</X>` iv_tag = `X`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_equals( act = lv_value exp = `&amp;` ).
  ENDMETHOD.
  METHOD references.
    DATA lt_objects TYPE zcl_osd_adt_scan=>tt_object.
    DATA ls_object TYPE zcl_osd_adt_types=>ty_object.
    lt_objects = zcl_osd_adt_scan=>references( `adtcore:uri="/sap/bc/adt/oo/classes/zcl_demo" adtcore:uri="other"` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_objects ) exp = 1 ).
    READ TABLE lt_objects INDEX 1 INTO ls_object.
    cl_abap_unit_assert=>assert_equals( act = ls_object-name exp = `ZCL_DEMO` ).
  ENDMETHOD.
ENDCLASS.
