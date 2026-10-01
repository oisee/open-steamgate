"! A byte source in UTF-16 (LE or BE) or ISO-8859-1 handed out as UTF-8,
"! chunk by chunk: a code unit or a surrogate pair cut by a chunk boundary
"! waits for the next chunk. IV_HEAD is read before the source. A lone
"! surrogate is passed through in its three-byte form, an odd byte at the
"! end of a UTF-16 stream becomes U+FFFD.
CLASS zcl_osd_bytes_to_utf8 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_byte_source.
    "! UTF-16LE, UTF-16BE, UTF-16 (big endian), ISO-8859-1 / LATIN1, US-ASCII
    CLASS-METHODS supports
      IMPORTING iv_from      TYPE string
      RETURNING VALUE(rv_yes) TYPE abap_bool.
    METHODS constructor
      IMPORTING io_source TYPE REF TO zif_osd_byte_source
                iv_head   TYPE xstring OPTIONAL
                iv_from   TYPE string.
  PRIVATE SECTION.
    TYPES ty_byte TYPE x LENGTH 1.
    DATA mo_source TYPE REF TO zif_osd_byte_source.
    DATA mv_pending TYPE xstring.
    DATA mv_kind TYPE c LENGTH 2.
    DATA mv_eof TYPE abap_bool.
    CLASS-METHODS kind_of
      IMPORTING iv_from       TYPE string
      RETURNING VALUE(rv_kind) TYPE string.
    METHODS utf8
      IMPORTING iv_code TYPE i
      CHANGING  cv_out  TYPE xstring.
    METHODS unit
      IMPORTING iv_pos         TYPE i
      RETURNING VALUE(rv_unit) TYPE i.
ENDCLASS.


CLASS zcl_osd_bytes_to_utf8 IMPLEMENTATION.

  METHOD kind_of.
    DATA lv_from TYPE string.
    lv_from = iv_from.
    TRANSLATE lv_from TO UPPER CASE.
    CASE lv_from.
      WHEN 'UTF-16LE'.
        rv_kind = 'LE'.
      WHEN 'UTF-16BE' OR 'UTF-16'.
        rv_kind = 'BE'.
      WHEN 'ISO-8859-1' OR 'ISO_8859-1' OR 'LATIN1' OR 'LATIN-1' OR 'US-ASCII' OR 'ASCII'.
        rv_kind = 'L1'.
    ENDCASE.
  ENDMETHOD.

  METHOD supports.
    IF kind_of( iv_from ) IS NOT INITIAL.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD constructor.
    mo_source = io_source.
    mv_pending = iv_head.
    mv_kind = kind_of( iv_from ).
    ASSERT mv_kind IS NOT INITIAL.
  ENDMETHOD.

  METHOD utf8.
    DATA lv_b TYPE ty_byte.
    DATA lv_c TYPE ty_byte.
    DATA lv_d TYPE ty_byte.
    DATA lv_e TYPE ty_byte.
    IF iv_code < 128.
      lv_b = iv_code.
      CONCATENATE cv_out lv_b INTO cv_out IN BYTE MODE.
    ELSEIF iv_code < 2048.
      lv_b = 192 + iv_code DIV 64.
      lv_c = 128 + iv_code MOD 64.
      CONCATENATE cv_out lv_b lv_c INTO cv_out IN BYTE MODE.
    ELSEIF iv_code < 65536.
      lv_b = 224 + iv_code DIV 4096.
      lv_c = 128 + ( iv_code DIV 64 ) MOD 64.
      lv_d = 128 + iv_code MOD 64.
      CONCATENATE cv_out lv_b lv_c lv_d INTO cv_out IN BYTE MODE.
    ELSE.
      lv_b = 240 + iv_code DIV 262144.
      lv_c = 128 + ( iv_code DIV 4096 ) MOD 64.
      lv_d = 128 + ( iv_code DIV 64 ) MOD 64.
      lv_e = 128 + iv_code MOD 64.
      CONCATENATE cv_out lv_b lv_c lv_d lv_e INTO cv_out IN BYTE MODE.
    ENDIF.
  ENDMETHOD.

  METHOD unit.
    DATA lv_first TYPE ty_byte.
    DATA lv_second TYPE ty_byte.
    DATA lv_at TYPE i.
    DATA lv_hi TYPE i.
    DATA lv_lo TYPE i.
    lv_first = mv_pending+iv_pos(1).
    lv_at = iv_pos + 1.
    lv_second = mv_pending+lv_at(1).
    IF mv_kind = 'LE'.
      lv_lo = lv_first.
      lv_hi = lv_second.
    ELSE.
      lv_hi = lv_first.
      lv_lo = lv_second.
    ENDIF.
    rv_unit = lv_hi * 256 + lv_lo.
  ENDMETHOD.

  METHOD zif_osd_byte_source~next.
    DATA lv_chunk TYPE xstring.
    DATA lv_pos TYPE i.
    DATA lv_len TYPE i.
    DATA lv_byte TYPE ty_byte.
    DATA lv_code TYPE i.
    DATA lv_low TYPE i.
    WHILE xstrlen( rv ) = 0.
      IF mv_eof = abap_false AND ( xstrlen( mv_pending ) < 4 OR mv_kind = 'L1' ).
        lv_chunk = mo_source->next( ).
        IF xstrlen( lv_chunk ) = 0.
          mv_eof = abap_true.
        ELSE.
          CONCATENATE mv_pending lv_chunk INTO mv_pending IN BYTE MODE.
        ENDIF.
      ENDIF.
      lv_len = xstrlen( mv_pending ).
      IF lv_len = 0.
        RETURN.
      ENDIF.
      lv_pos = 0.
      IF mv_kind = 'L1'.
        WHILE lv_pos < lv_len.
          lv_byte = mv_pending+lv_pos(1).
          lv_code = lv_byte.
          utf8( EXPORTING iv_code = lv_code
                CHANGING  cv_out  = rv ).
          lv_pos = lv_pos + 1.
        ENDWHILE.
      ELSE.
        WHILE lv_pos + 2 <= lv_len.
          lv_code = unit( lv_pos ).
          IF lv_code >= 55296 AND lv_code <= 56319.
            IF lv_pos + 4 > lv_len AND mv_eof = abap_false.
* the low half is in the next chunk
              EXIT.
            ENDIF.
            IF lv_pos + 4 <= lv_len.
              lv_low = unit( lv_pos + 2 ).
              IF lv_low >= 56320 AND lv_low <= 57343.
                lv_code = 65536 + ( lv_code - 55296 ) * 1024 + lv_low - 56320.
                lv_pos = lv_pos + 2.
              ENDIF.
            ENDIF.
          ENDIF.
          utf8( EXPORTING iv_code = lv_code
                CHANGING  cv_out  = rv ).
          lv_pos = lv_pos + 2.
        ENDWHILE.
        IF mv_eof = abap_true AND lv_pos < lv_len AND lv_pos + 2 > lv_len.
          utf8( EXPORTING iv_code = 65533
                CHANGING  cv_out  = rv ).
          lv_pos = lv_len.
        ENDIF.
      ENDIF.
      IF lv_pos >= lv_len.
        CLEAR mv_pending.
      ELSE.
        mv_pending = mv_pending+lv_pos.
      ENDIF.
      IF mv_eof = abap_true AND xstrlen( rv ) = 0 AND xstrlen( mv_pending ) = 0.
        RETURN.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

ENDCLASS.
