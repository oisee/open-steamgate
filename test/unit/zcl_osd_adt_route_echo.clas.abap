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
