"! Strong entity tags and the two distinct HTTP conditional rules.
"! String answers carry a charset; Node Buffer answers retain the bare type.
CLASS zcl_osd_adt_entity DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS tag IMPORTING iv_body TYPE string RETURNING VALUE(rv_tag) TYPE string.
    CLASS-METHODS normalized IMPORTING iv_tag TYPE string RETURNING VALUE(rv_tag) TYPE string.
    CLASS-METHODS send IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
      iv_body TYPE string iv_type TYPE string iv_note TYPE string OPTIONAL
      iv_charset TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
ENDCLASS.
CLASS zcl_osd_adt_entity IMPLEMENTATION.
  METHOD tag.
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = iv_body
      IMPORTING ef_hashstring = rv_tag ).
    rv_tag = to_lower( rv_tag(32) ).
  ENDMETHOD.
  METHOD normalized.
    rv_tag = zcl_osd_adt_js=>trim( iv_tag ).
    IF strlen( rv_tag ) >= 2 AND rv_tag(2) = `W/`.
      rv_tag = substring( val = rv_tag off = 2 ).
    ENDIF.
    IF rv_tag IS NOT INITIAL AND rv_tag(1) = `"`.
      rv_tag = substring( val = rv_tag off = 1 ).
    ENDIF.
    IF rv_tag IS NOT INITIAL AND substring( val = rv_tag off = strlen( rv_tag ) - 1 ) = `"`.
      rv_tag = substring( val = rv_tag len = strlen( rv_tag ) - 1 ).
    ENDIF.
  ENDMETHOD.
  METHOD send.
    DATA lv_tag TYPE string.
    DATA lv_none TYPE string.
    DATA lt_candidates TYPE string_table.
    DATA lv_candidate TYPE string.
    DATA ls_header TYPE ihttpnvp.
    lv_tag = tag( iv_body ).
    rs_response-status = 200.
    rs_response-content_type = iv_type.
    IF iv_charset = abap_true AND iv_type NS `charset=`.
      rs_response-content_type = to_lower( iv_type ) && `; charset=utf-8`.
    ENDIF.
    rs_response-body = iv_body.
    ls_header-name = `ETag`.
    ls_header-value = lv_tag.
    APPEND ls_header TO rs_response-headers.
    IF iv_note IS NOT INITIAL.
      ls_header-name = `X-OSD-History`.
      ls_header-value = `none: ` && iv_note.
      APPEND ls_header TO rs_response-headers.
    ENDIF.
    lv_none = zcl_osd_adt_csrf=>header( it_headers = is_request-headers iv_name = `if-none-match` ).
    SPLIT lv_none AT `,` INTO TABLE lt_candidates.
    LOOP AT lt_candidates INTO lv_candidate.
      IF normalized( lv_candidate ) = lv_tag.
        rs_response-status = 304.
        rs_response-content_type = iv_type.
        CLEAR rs_response-body.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
