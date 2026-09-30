CLASS zcl_osd_dsl_profile DEFINITION PUBLIC FINAL CREATE PRIVATE.
* A deliberately small lexical check: ABAP * comments start in column one;
* a double quote starts a comment outside a literal. SQLScript -- starts a
* comment outside a literal. Single quotes and backticks delimit literals;
* doubled delimiters stay inside the literal. This is not a full parser.
  PUBLIC SECTION.
    TYPES BEGIN OF ty_finding.
    TYPES severity TYPE c LENGTH 1.
    TYPES line TYPE i.
    TYPES template_line TYPE i.
    TYPES node TYPE string.
    TYPES rule TYPE string.
    TYPES text TYPE string.
    TYPES END OF ty_finding.
    TYPES tt_finding TYPE STANDARD TABLE OF ty_finding WITH DEFAULT KEY.
    CLASS-METHODS check
      IMPORTING iv_profile TYPE string iv_strict TYPE abap_bool
                is_result TYPE zcl_osd_tpl=>ty_result
                io_model TYPE REF TO zif_ajson
      RETURNING VALUE(rt_finding) TYPE tt_finding.
ENDCLASS.

CLASS zcl_osd_dsl_profile IMPLEMENTATION.
  METHOD check.
    DATA lv_line TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA ls_finding TYPE ty_finding.
    DATA lv_pos TYPE i.
    DATA lv_line_number TYPE i.
    DATA lv_len TYPE i.
    DATA lv_char TYPE c LENGTH 1.
    DATA lv_next TYPE c LENGTH 1.
    DATA lv_quote TYPE c LENGTH 1.
    DATA lv_comment TYPE abap_bool.
    DATA lv_soft TYPE abap_bool.
    DATA lv_node TYPE string.
    DATA lv_ascii_limit TYPE string.
    IF iv_profile = 'text'.
      RETURN.
    ENDIF.
    lv_ascii_limit = cl_abap_codepage=>convert_from( source = '7F' ).
    LOOP AT is_result-lines INTO lv_line.
      lv_line_number = sy-tabix.
      READ TABLE is_result-trace INTO ls_trace WITH KEY line = lv_line_number.
      lv_node = zcl_osd_dsl_trace=>node_of( io_model = io_model iv_path = ls_trace-path ).
      CLEAR ls_finding.
      ls_finding-severity = 'E'.
      ls_finding-line = lv_line_number.
      ls_finding-template_line = ls_trace-template_line.
      ls_finding-node = lv_node.
      lv_len = strlen( lv_line ).
      IF lv_len > 255.
        ls_finding-rule = 'line_length'.
        ls_finding-text = 'Line exceeds 255 characters'.
        APPEND ls_finding TO rt_finding.
      ENDIF.
      IF lv_len > 0.
        lv_char = substring( val = lv_line off = lv_len - 1 len = 1 ).
        IF lv_char = space OR lv_char = cl_abap_char_utilities=>horizontal_tab.
          ls_finding-rule = 'trailing_blank'.
          ls_finding-text = 'Trailing blank'.
          APPEND ls_finding TO rt_finding.
        ENDIF.
      ENDIF.
      CLEAR lv_quote.
      lv_comment = abap_false.
      IF iv_profile = 'abap' AND lv_len > 0 AND lv_line(1) = '*'.
        lv_comment = abap_true.
      ENDIF.
      lv_pos = 0.
      WHILE lv_pos < lv_len.
        lv_char = substring( val = lv_line off = lv_pos len = 1 ).
        CLEAR lv_next.
        IF lv_pos + 1 < lv_len.
          lv_next = substring( val = lv_line off = lv_pos + 1 len = 1 ).
        ENDIF.
        IF lv_char > lv_ascii_limit.
          ls_finding-rule = 'non_ascii'.
          ls_finding-text = 'Character outside 7-bit ASCII'.
          ls_finding-severity = 'E'.
          IF ( lv_comment = abap_true OR lv_quote IS NOT INITIAL )
              AND iv_strict = abap_false.
            ls_finding-severity = 'W'.
          ENDIF.
          APPEND ls_finding TO rt_finding.
        ENDIF.
        IF lv_comment = abap_false.
          IF lv_quote IS NOT INITIAL.
            IF lv_quote = '|' AND lv_char = '\'.
              " a string template escapes with a backslash, not by doubling
              lv_pos = lv_pos + 1.
            ELSEIF lv_quote = '|' AND lv_char = '|'.
              CLEAR lv_quote.
            ELSEIF lv_char = lv_quote.
              IF lv_next = lv_quote.
                lv_pos = lv_pos + 1.
              ELSE.
                CLEAR lv_quote.
              ENDIF.
            ENDIF.
          ELSEIF lv_char = `'` OR lv_char = '`'.
            lv_quote = lv_char.
          ELSEIF iv_profile = 'abap' AND lv_char = '|'.
            " a string template is a literal too; an embedded { expression } is
            " counted as part of it
            lv_quote = lv_char.
          ELSEIF iv_profile = 'abap' AND lv_char = '"'.
            lv_comment = abap_true.
          ELSEIF iv_profile = 'sqlscript' AND lv_char = '-' AND lv_next = '-'.
            lv_comment = abap_true.
          ENDIF.
        ENDIF.
        lv_pos = lv_pos + 1.
      ENDWHILE.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
