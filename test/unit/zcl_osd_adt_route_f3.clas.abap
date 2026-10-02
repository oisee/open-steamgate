"! Test-only continuation route, never a system seed.
CLASS zcl_osd_adt_route_f3 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    INTERFACES zif_osd_adt_resumable.
ENDCLASS.
CLASS zcl_osd_adt_route_f3 IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA ls_field TYPE ihttpnvp.
    IF is_request-method = `POST`.
      rs_response-status = 200.
      rs_response-body = cl_abap_codepage=>convert_from( is_request-body ).
      RETURN.
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
    IF iv_kind = `f3-unit`.
      rs_response-status = 200.
      rs_response-body = iv_json.
      RETURN.
    ENDIF.
    IF iv_json = `raise-adt`.
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
