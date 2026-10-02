"! A route for test/adt-abap-front.mjs only: it ends in a HOST verdict
"! with the continuation kind echo, the one a host registers for tests
"! (tools/adt-abap-front.mjs), or the kind ?kind= names. Its payload names the request, and its own
"! answer is what a continuation may replay or replace.
"! Test-only ABAP: never in a system seed (TEST_ONLY_ABAP).
CLASS zcl_osd_adt_route_echo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.

CLASS zcl_osd_adt_route_echo IMPLEMENTATION.

  METHOD zif_osd_adt_route~handle.
    DATA ls_field TYPE ihttpnvp.
    DATA lv_handle TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    READ TABLE is_request-query INTO ls_field WITH KEY name = `f1`.
    IF sy-subrc = 0.
      rs_response-status = 200.
      rs_response-content_type = `text/plain; charset=utf-8`.
      rs_response-body = |{ is_request-session-id };{ is_request-session-user };{ is_request-session-stateful };{ is_request-pattern };{ is_request-uri }|.
      IF ls_field-value = `context`.
        RETURN.
      ENDIF.
      lv_handle = is_request-sessions->adopt_handle( iv_id = is_request-session-id
        iv_type = `CLAS` iv_name = `ZF1_ROUTE_WORK` ).
      IF ls_field-value = `adt`.
        lx_error = zcx_osd_adt=>not_found( `F1 route refusal` ).
        RAISE EXCEPTION lx_error.
      ELSEIF ls_field-value = `root`.
        RAISE EXCEPTION TYPE cx_sy_zerodivide.
      ELSEIF ls_field-value = `status`.
        rs_response-status = 400.
      ENDIF.
      rs_response-body = lv_handle.
      RETURN.
    ENDIF.
    rs_response-status = 202.
    rs_response-content_type = `text/plain; charset=utf-8`.
    rs_response-body = `decided in ABAP`.
    rs_response-continuation-kind = `echo`.
*   ?kind= names another kind, for a test of the registry
    READ TABLE is_request-query INTO ls_field WITH KEY name = `kind`.
    IF sy-subrc = 0.
      rs_response-continuation-kind = ls_field-value.
    ENDIF.
    rs_response-continuation-payload = |\{"method":"{ is_request-method }","path":"{ is_request-path }"\}|.
  ENDMETHOD.

ENDCLASS.
