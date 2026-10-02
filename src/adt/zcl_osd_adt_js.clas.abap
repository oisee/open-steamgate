"! JavaScript conversions used by ADT selectors. Infinity is explicit.
"! COLLATE is for ASCII repository identifiers; host lists keep host order.
CLASS zcl_osd_adt_js DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_number,
             value TYPE f,
             nan TYPE abap_bool,
             infinity TYPE i,
           END OF ty_number.
    CLASS-METHODS number IMPORTING iv_text TYPE string RETURNING VALUE(rs_number) TYPE ty_number.
    CLASS-METHODS js_int IMPORTING iv_text TYPE string iv_radix TYPE i DEFAULT 0 RETURNING VALUE(rs_number) TYPE ty_number.
    CLASS-METHODS glob IMPORTING iv_pattern TYPE string iv_text TYPE string RETURNING VALUE(rv_match) TYPE abap_bool.
    CLASS-METHODS collate IMPORTING iv_text TYPE string RETURNING VALUE(rv_key) TYPE string.
    CLASS-METHODS trim IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS radix IMPORTING iv_text TYPE string iv_base TYPE i iv_prefix TYPE abap_bool
      RETURNING VALUE(rs_number) TYPE ty_number.
ENDCLASS.
CLASS zcl_osd_adt_js IMPLEMENTATION.
  METHOD trim.
    DATA lv_space TYPE string.
    DATA lv_start TYPE i.
    DATA lv_end TYPE i.
    DATA lv_len TYPE i.
    lv_space = cl_abap_codepage=>convert_from(
      '090A0B0C0D20C2A0E19A80E28080E28081E28082E28083E28084E28085E28086E28087E28088E28089E2808AE280A8E280A9E280AFE2819FE38080EFBBBF' ).
    lv_end = strlen( iv_text ).
    WHILE lv_start < lv_end AND iv_text+lv_start(1) CA lv_space.
      lv_start = lv_start + 1.
    ENDWHILE.
    WHILE lv_end > lv_start.
      lv_len = lv_end - 1.
      IF iv_text+lv_len(1) NA lv_space.
        EXIT.
      ENDIF.
      lv_end = lv_end - 1.
    ENDWHILE.
    lv_len = lv_end - lv_start.
    rv_text = iv_text+lv_start(lv_len).
  ENDMETHOD.
  METHOD radix.
    DATA lv_off TYPE i.
    DATA lv_digit TYPE i.
    DATA lv_char TYPE string.
    DATA lv_digits TYPE string VALUE `0123456789abcdefghijklmnopqrstuvwxyz`.
    DATA lv_count TYPE i.
    rs_number-nan = abap_true.
    IF iv_base < 2 OR iv_base > 36.
      RETURN.
    ENDIF.
    DO strlen( iv_text ) TIMES.
      lv_off = sy-index - 1.
      lv_char = to_lower( iv_text+lv_off(1) ).
      FIND FIRST OCCURRENCE OF lv_char IN lv_digits MATCH OFFSET lv_digit.
      IF sy-subrc <> 0 OR lv_digit >= iv_base.
        IF iv_prefix = abap_false.
          CLEAR rs_number-value.
          RETURN.
        ENDIF.
        EXIT.
      ENDIF.
      rs_number-value = rs_number-value * iv_base + lv_digit.
      lv_count = lv_count + 1.
    ENDDO.
    rs_number-nan = boolc( lv_count = 0 ).
  ENDMETHOD.
  METHOD number.
    DATA lv_text TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_digits TYPE string.
    DATA lv_base TYPE i.
    lv_text = trim( iv_text ).
    IF lv_text IS INITIAL.
      RETURN.
    ENDIF.
    IF lv_text = `Infinity` OR lv_text = `+Infinity` OR lv_text = `-Infinity`.
      rs_number-infinity = 1.
      IF lv_text(1) = `-`.
        rs_number-infinity = -1.
      ENDIF.
      RETURN.
    ENDIF.
    IF strlen( lv_text ) >= 2.
      lv_prefix = to_lower( lv_text(2) ).
      CASE lv_prefix.
        WHEN `0x`.
          lv_base = 16.
        WHEN `0b`.
          lv_base = 2.
        WHEN `0o`.
          lv_base = 8.
      ENDCASE.
      IF lv_base > 0.
        lv_digits = substring( val = lv_text off = 2 ).
        rs_number = radix( iv_text = lv_digits iv_base = lv_base iv_prefix = abap_false ).
        RETURN.
      ENDIF.
    ENDIF.
    FIND FIRST OCCURRENCE OF REGEX `^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$` IN lv_text.
    IF sy-subrc <> 0.
      rs_number-nan = abap_true.
      RETURN.
    ENDIF.
    TRY.
        rs_number-value = lv_text.
      CATCH cx_sy_conversion_overflow.
        rs_number-infinity = 1.
        IF lv_text(1) = `-`.
          rs_number-infinity = -1.
        ENDIF.
      CATCH cx_sy_conversion_no_number.
        rs_number-nan = abap_true.
    ENDTRY.
  ENDMETHOD.
  METHOD js_int.
    DATA lv_text TYPE string.
    DATA lv_base TYPE i.
    DATA lv_sign TYPE i VALUE 1.
    lv_text = trim( iv_text ).
    IF lv_text IS NOT INITIAL AND ( lv_text(1) = `-` OR lv_text(1) = `+` ).
      IF lv_text(1) = `-`.
        lv_sign = -1.
      ENDIF.
      lv_text = substring( val = lv_text off = 1 ).
    ENDIF.
    lv_base = iv_radix.
    IF lv_base = 0.
      lv_base = 10.
      IF strlen( lv_text ) >= 2 AND to_lower( lv_text(2) ) = `0x`.
        lv_base = 16.
      ENDIF.
    ENDIF.
    IF lv_base = 16 AND strlen( lv_text ) >= 2 AND to_lower( lv_text(2) ) = `0x`.
      lv_text = substring( val = lv_text off = 2 ).
    ENDIF.
    rs_number = radix( iv_text = lv_text iv_base = lv_base iv_prefix = abap_true ).
    rs_number-value = rs_number-value * lv_sign.
  ENDMETHOD.
  METHOD glob.
    DATA lv_p TYPE i.
    DATA lv_t TYPE i.
    DATA lv_star TYPE i VALUE -1.
    DATA lv_retry TYPE i.
    WHILE lv_t < strlen( iv_text ).
      IF lv_p < strlen( iv_pattern ) AND iv_pattern+lv_p(1) = `*`.
        lv_star = lv_p.
        lv_p = lv_p + 1.
        lv_retry = lv_t.
      ELSEIF lv_p < strlen( iv_pattern ) AND iv_pattern+lv_p(1) = iv_text+lv_t(1).
        lv_p = lv_p + 1.
        lv_t = lv_t + 1.
      ELSEIF lv_star >= 0.
        lv_p = lv_star + 1.
        lv_retry = lv_retry + 1.
        lv_t = lv_retry.
      ELSE.
        RETURN.
      ENDIF.
    ENDWHILE.
    WHILE lv_p < strlen( iv_pattern ) AND iv_pattern+lv_p(1) = `*`.
      lv_p = lv_p + 1.
    ENDWHILE.
    rv_match = boolc( lv_p = strlen( iv_pattern ) ).
  ENDMETHOD.
  METHOD collate.
    DATA lv_weights TYPE string VALUE ` _-,;:!?.'"()[]{}@*/\&#%``^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz`.
    DATA lv_char TYPE string.
    DATA lv_off TYPE i.
    DATA lv_weight TYPE i.
    DATA lv_primary TYPE string.
    DATA lv_case TYPE string.
    DATA lv_part TYPE string.
    DO strlen( iv_text ) TIMES.
      lv_off = sy-index - 1.
      lv_char = iv_text+lv_off(1).
      FIND FIRST OCCURRENCE OF to_lower( lv_char ) IN lv_weights MATCH OFFSET lv_weight.
      IF sy-subrc <> 0.
        lv_weight = 99.
      ENDIF.
      lv_weight = lv_weight + 1.
      lv_part = |{ lv_weight WIDTH = 3 PAD = '0' ALIGN = RIGHT }|.
      lv_primary = lv_primary && lv_part.
      IF lv_char <> to_lower( lv_char ).
        lv_case = lv_case && `2`.
      ELSE.
        lv_case = lv_case && `1`.
      ENDIF.
    ENDDO.
    rv_key = lv_primary && `!` && lv_case.
  ENDMETHOD.
ENDCLASS.
