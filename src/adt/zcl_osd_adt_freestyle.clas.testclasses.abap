CLASS ltcl_freestyle DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS query FOR TESTING.
    METHODS messages FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_freestyle IMPLEMENTATION.
  METHOD query.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_pair TYPE ihttpnvp.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_freestyle=>query(
      is_request = ls_request iv_name = `rowNumber` iv_default = `100` ) exp = `100` ).
    ls_pair-name = `rowNumber`.
    APPEND ls_pair TO ls_request-query.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_freestyle=>query(
      is_request = ls_request iv_name = `rowNumber` iv_default = `100` ) exp = `` ).
    ls_pair-value = `5`.
    APPEND ls_pair TO ls_request-query.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_freestyle=>query(
      is_request = ls_request iv_name = `rowNumber` ) exp = `,5` ).
  ENDMETHOD.
  METHOD messages.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lo_json = zcl_ajson=>parse( `{"error":{},"message":"fallback","raw":"","code":"SQL_ERROR"}` ).
    TRY.
        zcl_osd_adt_freestyle=>refuse( io_json = lo_json iv_raw = abap_true ).
        cl_abap_unit_assert=>fail( `expected a refusal` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->message_text exp = `` ).
    ENDTRY.
    TRY.
        zcl_osd_adt_freestyle=>refuse( io_json = lo_json ).
        cl_abap_unit_assert=>fail( `expected a refusal` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->message_text exp = `fallback` ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
