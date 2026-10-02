CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS components FOR TESTING RAISING cx_static_check.
    METHODS queries FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD components.
    DATA lv_text TYPE string.
    DATA lv_ok TYPE abap_bool.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_uri=>encode_component( `/DEMO/A B+` ) exp = `%2FDEMO%2FA%20B%2B` ).
    zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = `%2fDEMO%2fA+B`
      IMPORTING ev_text = lv_text ev_ok = lv_ok ).
    cl_abap_unit_assert=>assert_true( lv_ok ).
    cl_abap_unit_assert=>assert_equals( act = lv_text exp = `/DEMO/A+B` ).
    zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = `%FF`
      IMPORTING ev_text = lv_text ev_ok = lv_ok ).
    cl_abap_unit_assert=>assert_false( lv_ok ).
    zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = `%zz`
      IMPORTING ev_text = lv_text ev_ok = lv_ok ).
    cl_abap_unit_assert=>assert_false( lv_ok ).
  ENDMETHOD.
  METHOD queries.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    zcl_osd_adt_uri=>query( EXPORTING iv_query = `a=one+two&a=&a=%zz&empty` iv_name = `a`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_true( lv_found ).
    cl_abap_unit_assert=>assert_equals( act = lv_value exp = `one two,,%zz` ).
    zcl_osd_adt_uri=>query( EXPORTING iv_query = `a=&empty` iv_name = `empty`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_true( lv_found ).
    cl_abap_unit_assert=>assert_initial( lv_value ).
    zcl_osd_adt_uri=>query( EXPORTING iv_query = `a=&empty` iv_name = `missing`
      IMPORTING ev_value = lv_value ev_found = lv_found ).
    cl_abap_unit_assert=>assert_false( lv_found ).
  ENDMETHOD.
ENDCLASS.
