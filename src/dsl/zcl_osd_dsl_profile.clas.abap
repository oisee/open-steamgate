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
    DATA lv_stack TYPE string.
    DATA lv_top TYPE string.
    DATA lv_depth TYPE i.
    DATA lv_escaped TYPE abap_bool.
    DATA lv_comment TYPE abap_bool.
    DATA lv_soft TYPE abap_bool.
    DATA lv_ascii_limit TYPE string.
    IF iv_profile = 'text'.
      RETURN.
    ENDIF.
    lv_ascii_limit = cl_abap_codepage=>convert_from( source = '7F' ).
    CLEAR lv_stack.
    LOOP AT is_result-lines INTO lv_line.
      lv_line_number = sy-tabix.
      READ TABLE is_result-trace INTO ls_trace WITH KEY line = lv_line_number.
      CLEAR ls_finding.
      ls_finding-severity = 'E'.
      ls_finding-line = lv_line_number.
      ls_finding-template_line = ls_trace-template_line.
      lv_len = strlen( lv_line ).
      IF lv_len > 255.
        ls_finding-rule = 'line_length'.
        ls_finding-text = 'Line exceeds 255 characters'.
        ls_finding-node = zcl_osd_dsl_trace=>node_of( io_model = io_model iv_path = ls_trace-path ).
        APPEND ls_finding TO rt_finding.
      ENDIF.
      IF lv_len > 0.
        lv_char = substring( val = lv_line off = lv_len - 1 len = 1 ).
        IF lv_char = space OR lv_char = cl_abap_char_utilities=>horizontal_tab.
          ls_finding-rule = 'trailing_blank'.
          ls_finding-text = 'Trailing blank'.
          ls_finding-node = zcl_osd_dsl_trace=>node_of( io_model = io_model iv_path = ls_trace-path ).
          APPEND ls_finding TO rt_finding.
        ENDIF.
      ENDIF.
      " a small lexer with a stack of contexts, top last: ' and ` quotes,
      " | string template text, { its expression (code); empty = code.
      " The stack lives across lines: an expression inside a template may go
      " on on the next line. Quotes and template text cannot, so they end with
      " their line.
      WHILE lv_stack IS NOT INITIAL AND substring( val = lv_stack off = strlen( lv_stack ) - 1 len = 1 ) <> '{'.
        lv_stack = substring( val = lv_stack len = strlen( lv_stack ) - 1 ).
      ENDWHILE.
      lv_escaped = abap_false.
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
        CLEAR lv_top.
        lv_depth = strlen( lv_stack ).
        IF lv_depth > 0.
          lv_top = substring( val = lv_stack off = lv_depth - 1 len = 1 ).
        ENDIF.
        IF lv_char > lv_ascii_limit.
          ls_finding-rule = 'non_ascii'.
          ls_finding-text = 'Character outside 7-bit ASCII'.
          ls_finding-severity = 'E'.
          IF ( lv_comment = abap_true OR lv_top = `'` OR lv_top = '`' OR lv_top = '|' )
              AND iv_strict = abap_false.
            ls_finding-severity = 'W'.
          ENDIF.
          ls_finding-node = zcl_osd_dsl_trace=>node_of( io_model = io_model iv_path = ls_trace-path ).
          APPEND ls_finding TO rt_finding.
        ENDIF.
        IF lv_comment = abap_true.
          " the rest of the line is comment
        ELSEIF lv_escaped = abap_true.
          lv_escaped = abap_false.
        ELSEIF lv_top = `'` OR lv_top = '`'.
          IF lv_char = lv_top.
            IF lv_next = lv_top.
              lv_pos = lv_pos + 1.
            ELSE.
              lv_stack = substring( val = lv_stack len = lv_depth - 1 ).
            ENDIF.
          ENDIF.
        ELSEIF lv_top = '|'.
          IF lv_char = '\'.
            lv_escaped = abap_true.
          ELSEIF lv_char = '{'.
            lv_stack = lv_stack && '{'.
          ELSEIF lv_char = '|'.
            lv_stack = substring( val = lv_stack len = lv_depth - 1 ).
          ENDIF.
        ELSE.
          " code: top level or inside a template's { expression }
          IF lv_char = `'` OR lv_char = '`'.
            lv_stack = lv_stack && lv_char.
          ELSEIF iv_profile = 'abap' AND lv_char = '|'.
            lv_stack = lv_stack && '|'.
          ELSEIF lv_top = '{' AND lv_char = '}'.
            lv_stack = substring( val = lv_stack len = lv_depth - 1 ).
          ELSEIF ( lv_top IS INITIAL OR lv_top = '{' ) AND iv_profile = 'abap' AND lv_char = '"'.
            lv_comment = abap_true.
          ELSEIF lv_top IS INITIAL AND iv_profile = 'sqlscript' AND lv_char = '-' AND lv_next = '-'.
            lv_comment = abap_true.
          ENDIF.
        ENDIF.
        lv_pos = lv_pos + 1.
      ENDWHILE.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
