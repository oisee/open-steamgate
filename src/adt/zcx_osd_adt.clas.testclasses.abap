CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS factories FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD factories.
    DATA lo_error TYPE REF TO zcx_osd_adt.
    lo_error = zcx_osd_adt=>modified( `changed` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 412 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionResourceIsModified` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->miss exp = `none` ).
    lo_error = zcx_osd_adt=>not_locked( `lock` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 409 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionResourceNotLocked` ).
    lo_error = zcx_osd_adt=>wrong_data( `data` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 400 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionResourceWrongData` ).
    lo_error = zcx_osd_adt=>no_access( iv_message = `no` iv_status = 405 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 405 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionResourceNoAccess` ).
    lo_error = zcx_osd_adt=>not_built( `build` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 503 ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionResourceNoAccess` ).
    lo_error = zcx_osd_adt=>transport_check_failed( `uri` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->type_id exp = `ExceptionTransportCheckFailed` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->status exp = 500 ).
    lo_error = zcx_osd_adt=>not_found( iv_message = `missing` iv_namespace = zcx_osd_adt=>c_namespace_osd iv_miss = `object` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->namespace exp = `org.open-steamgate.osd` ).
    cl_abap_unit_assert=>assert_equals( act = lo_error->miss exp = `object` ).
  ENDMETHOD.
ENDCLASS.
