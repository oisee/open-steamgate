"! One path segment, percent-decoded the way Express decodes a route
"! parameter (decodeURIComponent): every %XX is a byte, the bytes must be
"! UTF-8, and a plus sign stays a plus sign. A segment that is not that --
"! a % without two hex digits, bytes that are not UTF-8 -- is refused 400
"! with Express's message, "Failed to decode param '<segment>'".
"!
"! Written here rather than through cl_http_utility=>unescape_url: in
"! open-abap that is decodeURIComponent in a kernel line, and its URIError
"! is a JavaScript error no CATCH reaches; on a system it may read a plus
"! sign as a blank, which a path segment does not mean.
CLASS zcl_osd_adt_uri DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS decode_segment
      IMPORTING iv_segment     TYPE string
      RETURNING VALUE(rv_text) TYPE string
      RAISING   zcx_osd_adt.
    CLASS-METHODS encode_component IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS decode_component IMPORTING iv_text TYPE string
      EXPORTING ev_text TYPE string ev_ok TYPE abap_bool.
    "! Raw query text, not already decoded ICF form fields.
    CLASS-METHODS query IMPORTING iv_query TYPE string iv_name TYPE string
      EXPORTING ev_value TYPE string ev_found TYPE abap_bool.
  PRIVATE SECTION.
    CLASS-METHODS utf8
      IMPORTING iv_text         TYPE string
      RETURNING VALUE(rv_bytes) TYPE xstring.
    CLASS-METHODS refuse
      IMPORTING iv_segment TYPE string
      RAISING   zcx_osd_adt.
ENDCLASS.

CLASS zcl_osd_adt_uri IMPLEMENTATION.

  METHOD encode_component.
    DATA lv_bytes TYPE xstring.
    DATA lv_hex TYPE c LENGTH 2.
    DATA lv_off TYPE i.
    DATA lv_byte TYPE i.
    DATA lv_one TYPE xstring.
    DATA lv_char TYPE string.
    lv_bytes = utf8( iv_text ).
    DO xstrlen( lv_bytes ) TIMES.
      lv_off = sy-index - 1.
      lv_byte = lv_bytes+lv_off(1).
      IF lv_byte < 128.
        lv_one = lv_bytes+lv_off(1).
        lv_char = cl_abap_codepage=>convert_from( lv_one ).
      ELSE.
        CLEAR lv_char.
      ENDIF.
      IF ( lv_byte >= 65 AND lv_byte <= 90 ) OR ( lv_byte >= 97 AND lv_byte <= 122 )
          OR ( lv_char IS NOT INITIAL AND lv_char CA `0123456789-_.!~*'()` ).
        rv_text = rv_text && lv_char.
      ELSE.
        lv_hex = lv_bytes+lv_off(1).
        rv_text = rv_text && `%` && to_upper( lv_hex ).
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD decode_component.
    CLEAR: ev_text, ev_ok.
    TRY.
        ev_text = decode_segment( iv_text ).
        ev_ok = abap_true.
      CATCH cx_root.
        CLEAR ev_text.
    ENDTRY.
  ENDMETHOD.

  METHOD query.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA lv_key TYPE string.
    DATA lv_value TYPE string.
    DATA lv_decoded TYPE string.
    DATA lv_offset TYPE i.
    DATA lv_ok TYPE abap_bool.
    CLEAR: ev_value, ev_found.
    SPLIT iv_query AT `&` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      FIND FIRST OCCURRENCE OF `=` IN lv_part MATCH OFFSET lv_offset.
      IF sy-subrc = 0.
        lv_key = lv_part(lv_offset).
        lv_offset = lv_offset + 1.
        lv_value = substring( val = lv_part off = lv_offset ).
      ELSE.
        lv_key = lv_part.
        CLEAR lv_value.
      ENDIF.
      REPLACE ALL OCCURRENCES OF `+` IN lv_key WITH ` `.
      REPLACE ALL OCCURRENCES OF `+` IN lv_value WITH ` `.
      decode_component( EXPORTING iv_text = lv_key IMPORTING ev_text = lv_decoded ev_ok = lv_ok ).
      IF lv_ok = abap_true.
        lv_key = lv_decoded.
      ENDIF.
      IF lv_key <> iv_name.
        CONTINUE.
      ENDIF.
      decode_component( EXPORTING iv_text = lv_value IMPORTING ev_text = lv_decoded ev_ok = lv_ok ).
      IF lv_ok = abap_true.
        lv_value = lv_decoded.
      ENDIF.
      IF ev_found = abap_true.
        ev_value = ev_value && `,`.
      ENDIF.
      ev_value = ev_value && lv_value.
      ev_found = abap_true.
    ENDLOOP.
  ENDMETHOD.

  METHOD decode_segment.
    DATA lv_bytes TYPE xstring.
    DATA lv_len TYPE i.
    DATA lv_off TYPE i.
    DATA lv_next TYPE i.
    DATA lv_char TYPE string.
    DATA lv_hex TYPE c LENGTH 2.
    DATA lv_byte TYPE x LENGTH 1.
    DATA lo_conv TYPE REF TO cl_abap_conv_in_ce.
    DATA lv_literal TYPE xstring.
    DATA lv_start TYPE i.
    DATA lv_size TYPE i.
    DATA lv_part TYPE string.

    IF iv_segment NA '%'.
      rv_text = iv_segment.
      RETURN.
    ENDIF.

    lv_len = strlen( iv_segment ).
    WHILE lv_off < lv_len.
      lv_char = iv_segment+lv_off(1).
      IF lv_char = '%'.
        lv_next = lv_off + 1.
        IF lv_next + 2 > lv_len.
          refuse( iv_segment ).
        ENDIF.
        lv_hex = to_upper( iv_segment+lv_next(2) ).
        IF lv_hex CN '0123456789ABCDEF'.
          refuse( iv_segment ).
        ENDIF.
        lv_byte = lv_hex.
        CONCATENATE lv_bytes lv_byte INTO lv_bytes IN BYTE MODE.
        lv_off = lv_off + 3.
      ELSE.
        lv_start = lv_off.
        WHILE lv_off < lv_len AND iv_segment+lv_off(1) <> `%`.
          lv_off = lv_off + 1.
        ENDWHILE.
        lv_size = lv_off - lv_start.
        lv_part = iv_segment+lv_start(lv_size).
        lv_literal = utf8( lv_part ).
        CONCATENATE lv_bytes lv_literal INTO lv_bytes IN BYTE MODE.
      ENDIF.
    ENDWHILE.

*   strict: bytes that are not UTF-8 (a lone %FF, an overlong form, a
*   surrogate) are refused, as decodeURIComponent refuses them
    TRY.
        lo_conv = cl_abap_conv_in_ce=>create( encoding = 'UTF-8' ).
        lo_conv->convert( EXPORTING input = lv_bytes
                          IMPORTING data  = rv_text ).
      CATCH cx_sy_conversion_codepage.
        refuse( iv_segment ).
    ENDTRY.
  ENDMETHOD.

  METHOD utf8.
    cl_abap_conv_out_ce=>create( encoding = 'UTF-8' )->convert(
      EXPORTING data   = iv_text
      IMPORTING buffer = rv_bytes ).
  ENDMETHOD.

  METHOD refuse.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lv_message TYPE string.
    lv_message = |Failed to decode param '{ iv_segment }'|.
    CREATE OBJECT lx_error
      EXPORTING iv_status  = 400
                iv_type    = `ExceptionInvalidRequest`
                iv_message = lv_message.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.

ENDCLASS.
