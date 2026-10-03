CLASS zcl_osd_adt_feeds DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_atom TYPE string VALUE `application/atom+xml; charset=utf-8; type=feed`.
    TYPES ty_fraction TYPE p LENGTH 8 DECIMALS 7.
    CLASS-METHODS milliseconds IMPORTING iv_fraction TYPE ty_fraction RETURNING VALUE(rv_digits) TYPE string.
    CLASS-METHODS now_iso RETURNING VALUE(rv_iso) TYPE string.
    CLASS-METHODS iso IMPORTING iv_stamp TYPE timestampl RETURNING VALUE(rv_iso) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_feeds IMPLEMENTATION.
  METHOD now_iso.
    DATA lv_stamp TYPE timestampl.
    GET TIME STAMP FIELD lv_stamp.
    rv_iso = iso( lv_stamp ).
  ENDMETHOD.
  METHOD iso.
    DATA lv_date TYPE d.
    DATA lv_time TYPE t.
    DATA lv_digits TYPE string.
    DATA lv_whole TYPE timestamp.
    DATA lv_text TYPE string.
    DATA lv_integer TYPE string.
    DATA lv_fraction TYPE string.
*   Move to text before arithmetic: see packed-decimals in ANORMALIES.md.
    lv_text = iv_stamp.
    CONDENSE lv_text NO-GAPS.
    SPLIT lv_text AT `.` INTO lv_integer lv_fraction.
    lv_whole = lv_integer.
    CONVERT TIME STAMP lv_whole TIME ZONE 'UTC' INTO DATE lv_date TIME lv_time.
    lv_digits = milliseconds( `0.` && lv_fraction ).
    rv_iso = lv_date(4) && `-` && lv_date+4(2) && `-` && lv_date+6(2)
      && `T` && lv_time(2) && `:` && lv_time+2(2) && `:` && lv_time+4(2)
      && `.` && lv_digits && `Z`.
  ENDMETHOD.
  METHOD milliseconds.
    DATA lv_ms TYPE i.
    DATA lv_digits TYPE n LENGTH 3.
    lv_ms = trunc( iv_fraction * 1000 + '0.0005' ).
    IF lv_ms > 999.
      lv_ms = 999.
    ENDIF.
    lv_digits = lv_ms.
    rv_digits = lv_digits.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA lv_title TYPE string.
    DATA lv_updated TYPE string.
    ls_identity = zcl_osd_adt_host=>identity( ).
    lv_updated = now_iso( ).
    rs_response-status = 200.
    rs_response-content_type = c_atom.
    CASE is_request-pattern.
      WHEN `/sap/bc/adt/feeds`.
        lv_title = `ABAP System Monitoring`.
      WHEN `/sap/bc/adt/feeds/variants`.
        lv_title = `Feed Variants`.
      WHEN `/sap/bc/adt/runtime/dumps`.
        lv_title = `Runtime Errors`.
      WHEN `/sap/bc/adt/runtime/systemmessages`.
        lv_title = `System Messages`.
      WHEN `/sap/bc/adt/gw/errorlog`.
        lv_title = `SAP Gateway Error Log`.
      WHEN `/sap/bc/adt/system/users`.
        rs_response-body = `<?xml version="1.0" encoding="utf-8"?>`
          && `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">`
          && `<atom:title>Users</atom:title><atom:updated>` && lv_updated && `</atom:updated>`
          && `<atom:entry><atom:id>` && ls_identity-user_name && `</atom:id>`
          && `<atom:title>` && ls_identity-user_full_name && `</atom:title></atom:entry></atom:feed>`.
        RETURN.
    ENDCASE.
    rs_response-body = zcl_osd_adt_doc_common=>empty_feed(
      iv_user_full_name = ls_identity-user_full_name iv_system_id = ls_identity-system_id
      iv_title = lv_title iv_self = is_request-pattern iv_updated = lv_updated ).
  ENDMETHOD.
ENDCLASS.
