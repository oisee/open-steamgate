"! Test-only wire fixtures for the F2 front, never in a system seed.
CLASS zcl_osd_adt_route_f2 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.

CLASS zcl_osd_adt_route_f2 IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA ls_field TYPE ihttpnvp.
    DATA ls_header TYPE ihttpnvp.
    rs_response-status = 200.
    rs_response-content_type = `text/plain; charset=utf-8`.
    READ TABLE is_request-query INTO ls_field WITH KEY name = `mode`.
    CASE ls_field-value.
      WHEN `307` OR `201`.
        rs_response-status = ls_field-value.
        rs_response-body = `fixture bytes`.
        ls_header-name = `Set-Cookie`.
        ls_header-value = `one=1; Path=/`.
        APPEND ls_header TO rs_response-headers.
        ls_header-value = `two=2; Path=/`.
        APPEND ls_header TO rs_response-headers.
        ls_header-value = `three=3; Path=/`.
        APPEND ls_header TO rs_response-headers.
        ls_header-name = `Location`.
        ls_header-value = `/fixture/target`.
        APPEND ls_header TO rs_response-headers.
      WHEN `empty`.
        rs_response-status = 201.
      WHEN `host-cookie`.
        rs_response-continuation-kind = `f2-cookie`.
        ls_header-name = `Set-Cookie`.
        ls_header-value = `host=1; Path=/`.
        APPEND ls_header TO rs_response-headers.
      WHEN `miss`.
        rs_response-status = 404.
        rs_response-body = `fixture miss`.
        ls_header-name = `X-OSD-Miss`.
        READ TABLE is_request-query INTO ls_field WITH KEY name = `kind`.
        ls_header-value = ls_field-value.
        APPEND ls_header TO rs_response-headers.
      WHEN `query`.
        LOOP AT is_request-query INTO ls_field.
          rs_response-body = |{ rs_response-body }{ ls_field-name }={ ls_field-value };|.
        ENDLOOP.
      WHEN OTHERS.
        rs_response-body = `fixture logoff`.
    ENDCASE.
  ENDMETHOD.
ENDCLASS.
