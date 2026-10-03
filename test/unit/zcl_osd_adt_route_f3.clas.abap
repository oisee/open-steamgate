"! Test-only continuation route, never a system seed.
CLASS zcl_osd_adt_route_f3 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    INTERFACES zif_osd_adt_route.
    INTERFACES zif_osd_adt_resumable.
ENDCLASS.
CLASS zcl_osd_adt_route_f3 IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    zcl_osd_adt_router=>add( EXPORTING iv_method = `GET`
      iv_pattern = `/sap/bc/adt/f3` iv_handler = `ZCL_OSD_ADT_ROUTE_F3`
      iv_resume_kind = `b4-write` CHANGING ct_routes = lt_routes ).
    zcl_osd_adt_handler=>use_routes( lt_routes ).
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA ls_field TYPE ihttpnvp.
    DATA ls_probe TYPE zosd_prb.
    IF is_request-method = `POST`.
      rs_response-status = 200.
      rs_response-body = cl_abap_codepage=>convert_from( is_request-body ).
      RETURN.
    ENDIF.
    READ TABLE is_request-query INTO ls_field WITH KEY name = `write`.
    IF sy-subrc = 0.
      ls_probe-mandt = sy-mandt.
      ls_probe-k1 = `F3-HANDLE`.
      ls_probe-k2 = `committed`.
      INSERT zosd_prb FROM ls_probe.
    ENDIF.
    rs_response-status = 500.
    rs_response-body = `host unavailable`.
    rs_response-continuation-kind = `f3-write`.
    READ TABLE is_request-query INTO ls_field WITH KEY name = `kind`.
    IF sy-subrc = 0.
      rs_response-continuation-kind = ls_field-value.
    ENDIF.
    rs_response-continuation-payload = `{ "source": "resumed source" }`.
  ENDMETHOD.
  METHOD zif_osd_adt_resumable~resume.
    DATA lv_error TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA ls_probe TYPE zosd_prb.
    DATA lv_json TYPE string.
    IF iv_json = `terminal`.
      rs_response-continuation-kind = `f3-write`.
      RETURN.
    ENDIF.
    IF iv_kind = `f3-unit`.
      rs_response-status = 200.
      rs_response-body = iv_json.
      RETURN.
    ENDIF.
    IF iv_json = `activate`.
      CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
        EXPORTING iv_command = `ACTIVATE` iv_type = `PROG` iv_name = `ZF3_STORE`.
    ELSEIF iv_json = `system-json`.
      lv_json = zcl_osd_adt_host=>system( iv_kind = `BUILD` iv_name = `probe` iv_json = `{ "probe": true }` ).
      rs_response-status = 200.
      rs_response-body = lv_json.
      RETURN.
    ENDIF.
    IF iv_json = `raise-adt`.
      ls_probe-mandt = sy-mandt.
      ls_probe-k1 = `B4-RESUME`.
      ls_probe-k2 = `rollback`.
      INSERT zosd_prb FROM ls_probe.
      lx_error = zcx_osd_adt=>not_found( `resume refusal` ).
      RAISE EXCEPTION lx_error.
    ELSEIF iv_json = `raise-root`.
      RAISE EXCEPTION TYPE cx_sy_zerodivide.
    ENDIF.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `WRITE` iv_type = `PROG` iv_name = `ZF3_STORE`
                iv_source = iv_json
      IMPORTING ev_error = lv_error.
    IF lv_error IS NOT INITIAL.
      lx_error = zcx_osd_adt=>internal( lv_error ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `CHECK` iv_type = `PROG` iv_name = `ZF3_STORE`
      IMPORTING ev_error = lv_error.
    IF lv_error IS NOT INITIAL.
      lx_error = zcx_osd_adt=>internal( lv_error ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `text/plain; charset=utf-8`.
    rs_response-body = `finished through RESUME: ` && iv_kind && `;` && iv_json.
  ENDMETHOD.
ENDCLASS.
