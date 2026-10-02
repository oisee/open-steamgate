CLASS zcl_osd_adt_sessions DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS security_id
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_id) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_sessions IMPLEMENTATION.
  METHOD security_id.
    rv_id = to_upper( zcl_osd_adt_entity=>tag( iv_id ) ).
  ENDMETHOD.

  METHOD zif_osd_adt_route~handle.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lv_id TYPE string.
    rs_response-status = 200.
    lv_id = security_id( is_request-session-id ).
    IF is_request-method = `DELETE`.
      READ TABLE is_request-params INTO ls_param WITH KEY name = `id`.
      IF sy-subrc = 0 AND to_upper( ls_param-value ) = lv_id.
        is_request-sessions->end( is_request-session-id ).
      ENDIF.
      RETURN.
    ENDIF.
    rs_response-content_type = `application/vnd.sap.adt.core.http.session.v3+xml; charset=utf-8`.
    rs_response-body = `<?xml version="1.0" encoding="utf-8"?>`
      && `<http:session xmlns:http="http://www.sap.com/adt/http" xmlns:atom="http://www.w3.org/2005/Atom">`
      && `<atom:link href="/sap/bc/adt/core/http/sessions/` && lv_id && `"`
      && ` rel="http://www.sap.com/adt/categories/core/http/sessions/securitysession"`
      && ` title="Security session"/>`
      && `<atom:link href="/sap/public/bc/icf/logoff"`
      && ` rel="http://www.sap.com/adt/categories/core/http/sessions/logoff"`
      && ` title="Logoff resource"/>`
      && `<atom:link href="/sap/bc/adt/core/http/systeminformation"`
      && ` rel="http://www.sap.com/adt/categories/core/http/system/systeminformation"`
      && ` type="application/vnd.sap.adt.core.http.systeminformation.v1+json"`
      && ` title="System information resource"/>`
      && `<http:properties><http:property name="inactivityTimeout">1800</http:property></http:properties>`
      && `</http:session>`.
  ENDMETHOD.
ENDCLASS.
