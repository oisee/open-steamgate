CLASS ltcl_resume DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS teardown.
    METHODS known FOR TESTING.
    METHODS unknown FOR TESTING.
    METHODS typed_refusal FOR TESTING.
    METHODS root_refusal FOR TESTING.
    METHODS install IMPORTING iv_kind TYPE string.
ENDCLASS.
CLASS ltcl_resume IMPLEMENTATION.
  METHOD install.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    DATA ls_route LIKE LINE OF lt_routes.
    ls_route-handler = `ZCL_OSD_ADT_ROUTE_F3`.
    ls_route-resume_kind = iv_kind.
    APPEND ls_route TO lt_routes.
    zcl_osd_adt_handler=>use_routes( lt_routes ).
  ENDMETHOD.
  METHOD teardown.
    zcl_osd_adt_handler=>use_routes( ).
  ENDMETHOD.
  METHOD known.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    install( `f3-unit` ).
    ls_response = zcl_osd_adt_handler=>resume( iv_kind = `f3-unit` iv_json = `{"result":42}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = `{"result":42}` ).
  ENDMETHOD.
  METHOD unknown.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    install( `f3-unit` ).
    ls_response = zcl_osd_adt_handler=>resume( iv_kind = `missing` iv_json = `{}` ).
    lx_error = zcx_osd_adt=>internal( `no ABAP continuation missing is registered` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 500 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = lx_error->document( ) ).
  ENDMETHOD.
  METHOD typed_refusal.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    install( `f3-write` ).
    ls_response = zcl_osd_adt_handler=>resume( iv_kind = `f3-write` iv_json = `raise-adt` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 404 ).
  ENDMETHOD.
  METHOD root_refusal.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    install( `f3-write` ).
    ls_response = zcl_osd_adt_handler=>resume( iv_kind = `f3-write` iv_json = `raise-root` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 500 ).
  ENDMETHOD.
ENDCLASS.
