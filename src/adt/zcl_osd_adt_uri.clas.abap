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
  PRIVATE SECTION.
    CLASS-METHODS utf8
      IMPORTING iv_text         TYPE string
      RETURNING VALUE(rv_bytes) TYPE xstring.
    CLASS-METHODS refuse
      IMPORTING iv_segment TYPE string
      RAISING   zcx_osd_adt.
ENDCLASS.

CLASS zcl_osd_adt_uri IMPLEMENTATION.

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
        lv_literal = utf8( lv_char ).
        CONCATENATE lv_bytes lv_literal INTO lv_bytes IN BYTE MODE.
        lv_off = lv_off + 1.
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
