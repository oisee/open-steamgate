CLASS ltcl_profile DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS rules FOR TESTING RAISING cx_static_check.
    METHODS clean_mpc FOR TESTING RAISING cx_static_check.
    METHODS template_blank FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_profile IMPLEMENTATION.
  METHOD rules.
    DATA lo_model TYPE REF TO zif_ajson.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA lt_findings TYPE zcl_osd_dsl_profile=>tt_finding.
    DATA ls_finding TYPE zcl_osd_dsl_profile=>ty_finding.
    DATA lv_nonascii TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    lo_model = zcl_ajson=>parse( `{"@id":"root"}` ).
    lv_nonascii = cl_abap_codepage=>convert_from( source = 'C3A9' ).
    APPEND repeat( val = 'x' occ = 256 ) TO ls_result-lines.
    APPEND `a ` TO ls_result-lines.
    APPEND `"` && lv_nonascii TO ls_result-lines.
    APPEND `WRITE '` && lv_nonascii && `'` TO ls_result-lines.
    APPEND lv_nonascii TO ls_result-lines.
    APPEND `lv = |x` && lv_nonascii && `\|y|.` TO ls_result-lines.
    " right after the backslash, and inside { }, which is code
    APPEND `lv = |\` && lv_nonascii && `{ a` && lv_nonascii && ` }|.` TO ls_result-lines.
    " a brace inside a quoted literal in an expression is not a brace; a
    " quote inside an expression is a literal again
    APPEND `lv = |{ '{' }` && lv_nonascii && `{ '` && lv_nonascii && `' }|.` TO ls_result-lines.
    " an expression going on on the next line, and a comment inside one
    APPEND `lv = |{ x "` && lv_nonascii TO ls_result-lines.
    APPEND `}` && lv_nonascii && `|.` TO ls_result-lines.
    DO 10 TIMES.
      ls_trace-line = sy-index.
      ls_trace-template_line = sy-index + 10.
      ls_trace-path = '/'.
      APPEND ls_trace TO ls_result-trace.
    ENDDO.
    lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'abap' iv_strict = abap_false
                                               is_result = ls_result io_model = lo_model ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_findings ) exp = 12 ).
    READ TABLE lt_findings INDEX 1 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-rule exp = 'line_length' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-template_line exp = 11 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    READ TABLE lt_findings INDEX 2 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-rule exp = 'trailing_blank' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    READ TABLE lt_findings INDEX 3 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 3 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    READ TABLE lt_findings INDEX 4 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 4 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    READ TABLE lt_findings INDEX 5 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-rule exp = 'non_ascii' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 5 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    " inside a string template, after an escaped bar: a literal, so a warning
    READ TABLE lt_findings INDEX 6 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 6 ).
    READ TABLE lt_findings INDEX 7 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 7 ).
    READ TABLE lt_findings INDEX 8 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 7 ).
    READ TABLE lt_findings INDEX 9 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 8 ).
    READ TABLE lt_findings INDEX 10 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 8 ).
    " the comment inside the expression, then template text after the brace
    READ TABLE lt_findings INDEX 11 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 9 ).
    READ TABLE lt_findings INDEX 12 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 10 ).
    lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'abap' iv_strict = abap_true
                                               is_result = ls_result io_model = lo_model ).
    READ TABLE lt_findings INDEX 3 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'E' ).
    lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'text' iv_strict = abap_true
                                               is_result = ls_result io_model = lo_model ).
    cl_abap_unit_assert=>assert_initial( lt_findings ).
    CLEAR ls_result.
    APPEND `--` && lv_nonascii TO ls_result-lines.
    APPEND '`' && lv_nonascii && '`' TO ls_result-lines.
    APPEND lv_nonascii TO ls_result-lines.
    DO 3 TIMES.
      ls_trace-line = sy-index.
      ls_trace-template_line = sy-index + 20.
      ls_trace-path = '/'.
      APPEND ls_trace TO ls_result-trace.
    ENDDO.
    lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'sqlscript' iv_strict = abap_false
                                               is_result = ls_result io_model = lo_model ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_findings ) exp = 3 ).
    READ TABLE lt_findings INDEX 1 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-template_line exp = 21 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
    READ TABLE lt_findings INDEX 2 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'W' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-template_line exp = 22 ).
    READ TABLE lt_findings INDEX 3 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-severity exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-line exp = 3 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-template_line exp = 23 ).
  ENDMETHOD.

  METHOD clean_mpc.
    DATA ls_model TYPE zcl_stg_segw_gen=>ty_model.
    DATA ls_type TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA lt_findings TYPE zcl_osd_dsl_profile=>tt_finding.
    ls_model = zcl_stg_segw_gen=>build_model( 'ZSTG_MAPPED' ).
    cl_abap_unit_assert=>assert_not_initial( ls_model-entity_types ).
    LOOP AT ls_model-entity_types INTO ls_type.
      ls_result = zcl_osd_dsl_mpc=>render_entity( is_type = ls_type iv_mpc = ls_model-mpc ).
      lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'abap' iv_strict = abap_false
        is_result = ls_result io_model = zcl_osd_dsl_mpc=>entity_model(
          is_type = ls_type iv_mpc = ls_model-mpc ) ).
      cl_abap_unit_assert=>assert_initial( act = lt_findings msg = ls_type-name ).
    ENDLOOP.
  ENDMETHOD.

  METHOD template_blank.
    DATA lo_model TYPE REF TO zif_ajson.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA lt_findings TYPE zcl_osd_dsl_profile=>tt_finding.
    DATA ls_finding TYPE zcl_osd_dsl_profile=>ty_finding.
    lo_model = zcl_ajson=>parse( `{"@id":"root"}` ).
    ls_result = zcl_osd_tpl=>render( iv_template = `WRITE 'x'. `
                                      ii_data = lo_model ).
    lt_findings = zcl_osd_dsl_profile=>check( iv_profile = 'abap' iv_strict = abap_false
                                               is_result = ls_result io_model = lo_model ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_findings ) exp = 1 ).
    READ TABLE lt_findings INDEX 1 INTO ls_finding.
    cl_abap_unit_assert=>assert_equals( act = ls_finding-rule exp = 'trailing_blank' ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-template_line exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = ls_finding-node exp = 'root' ).
  ENDMETHOD.
ENDCLASS.
