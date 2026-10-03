CLASS zcl_osd_adt_occurrences DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.
CLASS zcl_osd_adt_occurrences IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA lv_key TYPE string.
    DATA lv_value TYPE string.
    DATA lv_decoded TYPE string.
    DATA lv_query TYPE string.
    DATA lv_offset TYPE i.
    DATA lv_count TYPE i.
    DATA lv_nested TYPE abap_bool.
    DATA lv_ok TYPE abap_bool.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    FIND FIRST OCCURRENCE OF `?` IN is_request-uri MATCH OFFSET lv_offset.
    IF sy-subrc = 0.
      lv_offset = lv_offset + 1.
      lv_query = substring( val = is_request-uri off = lv_offset ).
    ENDIF.
    SPLIT lv_query AT `&` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      FIND FIRST OCCURRENCE OF `=` IN lv_part MATCH OFFSET lv_offset.
      IF sy-subrc = 0.
        lv_key = lv_part(lv_offset).
      ELSE.
        lv_key = lv_part.
      ENDIF.
      REPLACE ALL OCCURRENCES OF `+` IN lv_key WITH ` `.
      zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = lv_key
        IMPORTING ev_text = lv_decoded ev_ok = lv_ok ).
      IF lv_ok = abap_true.
        lv_key = lv_decoded.
      ENDIF.
      IF lv_key = `uri`.
        lv_count = lv_count + 1.
      ELSEIF lv_key CP `uri[*`.
        lv_nested = abap_true.
      ENDIF.
    ENDLOOP.
    zcl_osd_adt_uri=>query( EXPORTING iv_query = lv_query iv_name = `uri`
      IMPORTING ev_value = lv_value ).
    IF lv_count <> 1 OR lv_value IS INITIAL OR lv_nested = abap_true.
      lx_error = zcx_osd_adt=>invalid_request( `uri is required` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `application/xml; charset=utf-8`.
    rs_response-body = `<?xml version="1.0" encoding="utf-8"?><occurrenceInfo xmlns="http://www.sap.com/adt/abapsource"><occurrences/></occurrenceInfo>`.
  ENDMETHOD.
ENDCLASS.
