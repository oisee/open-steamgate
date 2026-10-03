CLASS ltcl_osd_tpl DEFINITION FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS interpolation FOR TESTING RAISING cx_static_check.
    METHODS section_over_array FOR TESTING RAISING cx_static_check.
    METHODS standalone_leaves_no_line FOR TESTING RAISING cx_static_check.
    METHODS standalone_after_lines FOR TESTING RAISING cx_static_check.
    METHODS standalone_consecutive FOR TESTING RAISING cx_static_check.
    METHODS standalone_crlf FOR TESTING RAISING cx_static_check.
    METHODS final_newline_kept FOR TESTING RAISING cx_static_check.
    METHODS inverted_and_comment FOR TESTING RAISING cx_static_check.
    METHODS scalar_section_context FOR TESTING RAISING cx_static_check.
    METHODS root_array FOR TESTING RAISING cx_static_check.
    METHODS partial_is_indented FOR TESTING RAISING cx_static_check.
    METHODS partial_value_not_indented FOR TESTING RAISING cx_static_check.
    METHODS partial_blank_line_no_blanks FOR TESTING RAISING cx_static_check.
    METHODS partial_named_like_main FOR TESTING RAISING cx_static_check.
    METHODS partial_depth_boundary FOR TESTING RAISING cx_static_check.
    METHODS partial_arguments FOR TESTING RAISING cx_static_check.
    METHODS dotted_names FOR TESTING RAISING cx_static_check.
    METHODS slash_in_a_name FOR TESTING RAISING cx_static_check.
    METHODS trace_whole_table FOR TESTING RAISING cx_static_check.
    METHODS trace_static_block_lines FOR TESTING RAISING cx_static_check.
    METHODS trace_value_keeps_tag_line FOR TESTING RAISING cx_static_check.
    METHODS probes_erased_when_off FOR TESTING RAISING cx_static_check.
    METHODS deterministic FOR TESTING RAISING cx_static_check.
    METHODS html_escape_only_on_request FOR TESTING RAISING cx_static_check.
    METHODS xml_escape_all_five FOR TESTING RAISING cx_static_check.
    METHODS tag_whitespace FOR TESTING RAISING cx_static_check.
    METHODS loop_first_last_index FOR TESTING RAISING cx_static_check.
    METHODS filters FOR TESTING RAISING cx_static_check.
    METHODS unknown_filter_is_error FOR TESTING.
    METHODS unclosed_section_is_error FOR TESTING.
    METHODS unclosed_tag_names_template FOR TESTING.
    METHODS array_of_eleven_in_order FOR TESTING RAISING cx_static_check.
    METHODS lone_cr_at_end_kept FOR TESTING RAISING cx_static_check.
    METHODS inline_partial_not_indented FOR TESTING RAISING cx_static_check.
    METHODS inline_return_not_indented FOR TESTING RAISING cx_static_check.
    METHODS inline_return_after_literal FOR TESTING RAISING cx_static_check.
    METHODS inline_empty_keeps_indent FOR TESTING RAISING cx_static_check.
    METHODS newline_value_claims_path FOR TESTING RAISING cx_static_check.
    METHODS missing_partial_at_limit FOR TESTING RAISING cx_static_check.
    METHODS arguments_are_inherited FOR TESTING RAISING cx_static_check.
    METHODS shadowed_first_segment FOR TESTING RAISING cx_static_check.
    METHODS nested_loop_metadata FOR TESTING RAISING cx_static_check.
    METHODS filters_checked_without_value FOR TESTING.
    METHODS literal_char FOR TESTING RAISING cx_static_check.
    METHODS literal_string FOR TESTING RAISING cx_static_check.
    METHODS literal_integer FOR TESTING RAISING cx_static_check.
    METHODS literal_decimal FOR TESTING RAISING cx_static_check.
    METHODS literal_raw FOR TESTING RAISING cx_static_check.
    METHODS literal_missing_type FOR TESTING.
    METHODS literal_missing_value FOR TESTING.
    METHODS literal_absent_with_type FOR TESTING RAISING cx_static_check.
    METHODS literal_unknown_type FOR TESTING.
    METHODS literal_char_length FOR TESTING.
    METHODS literal_numc_digits FOR TESTING.
    METHODS literal_dats_digits FOR TESTING.
    METHODS literal_tims_digits FOR TESTING.
    METHODS literal_sstr_length FOR TESTING.
    METHODS literal_integer_range FOR TESTING.
    METHODS literal_decimal_number FOR TESTING.
    METHODS literal_decimal_precision FOR TESTING.
    METHODS literal_decimal_digits FOR TESTING.
    METHODS literal_raw_hex FOR TESTING.
    METHODS literal_raw_odd FOR TESTING.
    METHODS literal_raw_length FOR TESTING.
    METHODS literal_argument FOR TESTING.
    METHODS literal_composition FOR TESTING RAISING cx_static_check.
    METHODS literal_not_scalar FOR TESTING.
    METHODS literal_one_source_literal FOR TESTING.
    METHODS literal_normal_numbers FOR TESTING RAISING cx_static_check.
    METHODS utf8_passes_through FOR TESTING RAISING cx_static_check.
    METHODS utf8 IMPORTING iv_hex TYPE xstring RETURNING VALUE(rv) TYPE string.

    METHODS data
      IMPORTING
        iv_json        TYPE string
      RETURNING
        VALUE(ri_json) TYPE REF TO zif_ajson
      RAISING
        cx_static_check.

    METHODS text
      IMPORTING
        iv_template    TYPE string
        iv_json        TYPE string
        it_partials    TYPE zcl_osd_tpl=>tt_partials OPTIONAL
      RETURNING
        VALUE(rv_text) TYPE string
      RAISING
        cx_static_check.

    METHODS partial
      IMPORTING
        iv_name            TYPE string
        iv_template        TYPE string
      RETURNING
        VALUE(rt_partials) TYPE zcl_osd_tpl=>tt_partials.

    METHODS error_text
      IMPORTING
        iv_template    TYPE string
        iv_json        TYPE string
        it_partials    TYPE zcl_osd_tpl=>tt_partials OPTIONAL
      RETURNING
        VALUE(rv_text) TYPE string.

    METHODS nested_json
      IMPORTING
        iv_depth       TYPE i
      RETURNING
        VALUE(rv_json) TYPE string.

    METHODS nl
      RETURNING
        VALUE(rv_nl) TYPE string.

    METHODS crlf
      RETURNING
        VALUE(rv_crlf) TYPE string.

    METHODS tab
      RETURNING
        VALUE(rv_tab) TYPE string.
ENDCLASS.

CLASS ltcl_osd_tpl IMPLEMENTATION.

  METHOD data.
    ri_json = zcl_ajson=>parse( iv_json ).
  ENDMETHOD.

  METHOD text.
    rv_text = zcl_osd_tpl=>to_string( zcl_osd_tpl=>render(
      iv_template = iv_template
      ii_data     = data( iv_json )
      it_partials = it_partials ) ).
  ENDMETHOD.

  METHOD partial.
    DATA ls_partial TYPE zcl_osd_tpl=>ty_partial.
    ls_partial-name = iv_name.
    ls_partial-template = iv_template.
    APPEND ls_partial TO rt_partials.
  ENDMETHOD.

  METHOD error_text.
    DATA lx TYPE REF TO zcx_osd_tpl.
    DATA lx_other TYPE REF TO cx_static_check.
    TRY.
        zcl_osd_tpl=>render(
          iv_template = iv_template
          ii_data     = data( iv_json )
          it_partials = it_partials ).
        rv_text = `no error`.
      CATCH zcx_osd_tpl INTO lx.
        rv_text = lx->text.
      CATCH cx_static_check INTO lx_other.
        rv_text = `other error`.
    ENDTRY.
  ENDMETHOD.

  METHOD nested_json.
    " the innermost n is false: name lookup climbs the context stack, so an
    " absent n would be found in the parent and recurse to the limit
    rv_json = `false`.
    DO iv_depth TIMES.
      rv_json = `{"n":` && rv_json && `}`.
    ENDDO.
  ENDMETHOD.

  METHOD nl.
    rv_nl = cl_abap_char_utilities=>newline.
  ENDMETHOD.

  METHOD crlf.
    rv_crlf = cl_abap_char_utilities=>cr_lf.
  ENDMETHOD.

  METHOD tab.
    rv_tab = cl_abap_char_utilities=>horizontal_tab.
  ENDMETHOD.

  METHOD interpolation.
    cl_abap_unit_assert=>assert_equals(
      exp = `CLASS zcl_x DEFINITION. " 3 methods, true`
      act = text( iv_template = `CLASS {{name}} DEFINITION. " {{count}} methods, {{final}}`
                  iv_json     = `{"name":"zcl_x","count":3,"final":true}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `[]`
      act = text( iv_template = `[{{missing}}]` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD section_over_array.
    cl_abap_unit_assert=>assert_equals(
      exp = `a;b;c;`
      act = text( iv_template = `{{#items}}{{name}};{{/items}}`
                  iv_json     = `{"items":[{"name":"a"},{"name":"b"},{"name":"c"}]}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `1,2,`
      act = text( iv_template = `{{#n}}{{.}},{{/n}}` iv_json = `{"n":[1,2]}` ) ).
  ENDMETHOD.

  METHOD standalone_leaves_no_line.
    DATA lv_template TYPE string.
    lv_template = `METHODS:` && nl( )
      && `  {{#methods}}` && nl( )
      && `  {{name}},` && nl( )
      && `  {{/methods}}` && nl( )
      && `END.`.
    cl_abap_unit_assert=>assert_equals(
      exp = `METHODS:` && nl( ) && `  a,` && nl( ) && `  b,` && nl( ) && `END.`
      act = text( iv_template = lv_template
                  iv_json     = `{"methods":[{"name":"a"},{"name":"b"}]}` ) ).
  ENDMETHOD.

  METHOD standalone_after_lines.
    cl_abap_unit_assert=>assert_equals(
      exp = `A` && nl( ) && `B` && nl( ) && `D`
      act = text( iv_template = `A` && nl( ) && `B` && nl( ) && `{{!c}}` && nl( ) && `D`
                  iv_json     = `{}` ) ).
  ENDMETHOD.

  METHOD standalone_consecutive.
    cl_abap_unit_assert=>assert_equals(
      exp = `A` && nl( ) && `B`
      act = text( iv_template = `A` && nl( ) && `{{!a}}` && nl( ) && `{{!b}}` && nl( ) && `B`
                  iv_json     = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `A` && nl( ) && `x` && nl( ) && `B`
      act = text( iv_template = `A` && nl( ) && `{{#o}}` && nl( ) && `{{#p}}` && nl( ) && `x` && nl( )
                                && `{{/p}}` && nl( ) && `{{/o}}` && nl( ) && `B`
                  iv_json     = `{"o":{"p":true}}` ) ).
  ENDMETHOD.

  METHOD standalone_crlf.
    cl_abap_unit_assert=>assert_equals(
      exp = `A` && crlf( ) && `B`
      act = text( iv_template = `A` && crlf( ) && `{{!x}} ` && crlf( ) && `B`
                  iv_json     = `{}` ) ).
  ENDMETHOD.

  METHOD final_newline_kept.
    cl_abap_unit_assert=>assert_equals(
      exp = `a` && nl( )
      act = text( iv_template = `a` && nl( ) iv_json = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = nl( )
      act = text( iv_template = nl( ) iv_json = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `a` && nl( ) && nl( )
      act = text( iv_template = `a` && nl( ) && nl( ) iv_json = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = ``
      act = text( iv_template = `` iv_json = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `a`
      act = text( iv_template = `a` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD inverted_and_comment.
    DATA lv_template TYPE string.
    lv_template = `{{! a comment line }}` && nl( )
      && `{{^items}}none{{/items}}{{#items}}some{{/items}}`.
    cl_abap_unit_assert=>assert_equals(
      exp = `none`
      act = text( iv_template = lv_template iv_json = `{"items":[]}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `some`
      act = text( iv_template = lv_template iv_json = `{"items":[1]}` ) ).
  ENDMETHOD.

  METHOD scalar_section_context.
    cl_abap_unit_assert=>assert_equals(
      exp = `bar is bar`
      act = text( iv_template = `{{#foo}}{{.}} is {{foo}}{{/foo}}` iv_json = `{"foo":"bar"}` ) ).
  ENDMETHOD.

  METHOD root_array.
    cl_abap_unit_assert=>assert_equals(
      exp = `12`
      act = text( iv_template = `{{#.}}{{.}}{{/.}}` iv_json = `[1,2]` ) ).
  ENDMETHOD.

  METHOD partial_is_indented.
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  DATA a.` && nl( ) && `  DATA b.` && nl( ) && `ENDMETHOD.`
      act = text( iv_template = `METHOD m.` && nl( ) && `  {{> body}}` && nl( ) && `ENDMETHOD.`
                  iv_json     = `{}`
                  it_partials = partial( iv_name = `body` iv_template = `DATA a.` && nl( ) && `DATA b.` && nl( ) ) ) ).
  ENDMETHOD.

  METHOD partial_value_not_indented.
    cl_abap_unit_assert=>assert_equals(
      exp = `  a` && nl( ) && `b` && nl( ) && `END`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END`
                  iv_json     = `{"v":"a\nb"}`
                  it_partials = partial( iv_name = `p` iv_template = `{{v}}` && nl( ) ) ) ).
  ENDMETHOD.

  METHOD partial_blank_line_no_blanks.
    " deliberate deviation from the Mustache spec: a blank line of an indented
    " partial stays empty, so generated code has no trailing blanks
    cl_abap_unit_assert=>assert_equals(
      exp = `  a` && nl( ) && nl( ) && `  b` && nl( ) && `END`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END`
                  iv_json     = `{}`
                  it_partials = partial( iv_name = `p` iv_template = `a` && nl( ) && nl( ) && `b` && nl( ) ) ) ).
  ENDMETHOD.

  METHOD partial_named_like_main.
    cl_abap_unit_assert=>assert_equals(
      exp = `OK`
      act = text( iv_template = `{{>main}}`
                  iv_json     = `{}`
                  it_partials = partial( iv_name = `main` iv_template = `OK` ) ) ).
  ENDMETHOD.

  METHOD partial_depth_boundary.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    lt_partials = partial( iv_name = `r` iv_template = `{{#n}}{{>r}}{{/n}}.` ).
    " depth k of n gives k nested partials: 50 render, 51 are refused
    cl_abap_unit_assert=>assert_equals(
      exp = 50
      act = strlen( text( iv_template = `{{>r}}` iv_json = nested_json( 50 ) it_partials = lt_partials ) ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `r:1: partials nested deeper than 50`
      act = error_text( iv_template = `{{>r}}` iv_json = nested_json( 51 ) it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD partial_arguments.
    cl_abap_unit_assert=>assert_equals(
      exp = `METHODS a.METHODS b.`
      act = text( iv_template = `{{#methods}}{{> decl m=.}}{{/methods}}`
                  iv_json     = `{"methods":[{"name":"a"},{"name":"b"}]}`
                  it_partials = partial( iv_name = `decl` iv_template = `METHODS {{m.name}}.` ) ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: partial argument "m=nosuch" not found`
      act = error_text( iv_template = `{{> decl m=nosuch}}`
                        iv_json     = `{}`
                        it_partials = partial( iv_name = `decl` iv_template = `x` ) ) ).
  ENDMETHOD.

  METHOD slash_in_a_name.
* A name with a slash in it: the engine's path index would read "/a/b" as that
* member, ajson reads it as b under a. The render answers what ajson answers.
    cl_abap_unit_assert=>assert_equals(
      exp = `[]`
      act = text( iv_template = `[{{a/b}}]`
                  iv_json     = `{"a/b":"x"}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `[y]`
      act = text( iv_template = `[{{a.b}}]`
                  iv_json     = `{"a/b":"x","a":{"b":"y"}}` ) ).
  ENDMETHOD.


  METHOD dotted_names.
    cl_abap_unit_assert=>assert_equals(
      exp = `zcl_a/zcl_b`
      act = text( iv_template = `{{#cls}}{{name}}/{{super.name}}{{/cls}}`
                  iv_json     = `{"cls":{"name":"zcl_a","super":{"name":"zcl_b"}}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `outer`
      act = text( iv_template = `{{#inner}}{{label}}{{/inner}}`
                  iv_json     = `{"label":"outer","inner":{"x":1}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `inner`
      act = text( iv_template = `{{#inner}}{{label}}{{/inner}}`
                  iv_json     = `{"label":"outer","inner":{"label":"inner"}}` ) ).
  ENDMETHOD.

  METHOD trace_static_block_lines.
* One static token over several template lines: each output line names its
* own template line, not the line the token starts on.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lt_contributors TYPE zcl_osd_tpl=>tt_contributions.
    DATA ls_contributor TYPE zcl_osd_tpl=>ty_contribution.
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{x}}` && nl( ) && `a` && nl( ) && `b` && nl( ) && `c`
      ii_data     = data( `{"x":"1"}` )
      iv_name     = `blk` ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = lines( ls_result-trace ) ).
    LOOP AT ls_result-trace INTO ls_trace.
      cl_abap_unit_assert=>assert_equals( exp = sy-tabix act = ls_trace-template_line ).
      CLEAR lt_contributors.
      ls_contributor-template = `blk`.
      ls_contributor-template_line = ls_trace-line.
      ls_contributor-invocation = 1.
      IF ls_trace-line = 1.
        ls_contributor-path = `/x`.
        APPEND ls_contributor TO lt_contributors.
      ENDIF.
      ls_contributor-path = `/`.
      APPEND ls_contributor TO lt_contributors.
      cl_abap_unit_assert=>assert_equals( exp = lt_contributors act = ls_trace-contributors ).
    ENDLOOP.
  ENDMETHOD.


  METHOD trace_whole_table.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA lt_exp TYPE zcl_osd_tpl=>tt_trace.
    DATA ls_exp TYPE zcl_osd_tpl=>ty_trace.
    DATA ls_contributor TYPE zcl_osd_tpl=>ty_contribution.
    DATA lv_template TYPE string.
    lv_template = `CLASS x.` && nl( )
      && `{{#methods}}` && nl( )
      && `  METHODS {{name}}.` && nl( )
      && `{{/methods}}` && nl( )
      && `ENDCLASS.`.
    ls_result = zcl_osd_tpl=>render(
      iv_template = lv_template
      ii_data     = data( `{"methods":[{"name":"a"},{"name":"b"}]}` )
      iv_name     = `cls` ).

* All emitting paths contribute, including literal text in a loop's context.
* Repeated tokens with the same path and invocation contribute only once.
    ls_contributor-template = `cls`.
    ls_contributor-invocation = 1.
    ls_exp-template = `cls`.
    ls_exp-line = 1.
    ls_exp-template_line = 1.
    ls_exp-path = `/`.
    ls_contributor-template_line = 1.
    ls_contributor-path = `/`.
    APPEND ls_contributor TO ls_exp-contributors.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 2.
    ls_exp-template_line = 3.
    ls_exp-path = `/methods/1/name`.
    CLEAR ls_exp-contributors.
    ls_contributor-template_line = 3.
    ls_contributor-path = `/methods/1`.
    APPEND ls_contributor TO ls_exp-contributors.
    ls_contributor-path = `/methods/1/name`.
    APPEND ls_contributor TO ls_exp-contributors.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 3.
    ls_exp-template_line = 3.
    ls_exp-path = `/methods/2/name`.
    CLEAR ls_exp-contributors.
    ls_contributor-path = `/methods/2`.
    APPEND ls_contributor TO ls_exp-contributors.
    ls_contributor-path = `/methods/2/name`.
    APPEND ls_contributor TO ls_exp-contributors.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 4.
    ls_exp-template_line = 5.
    ls_exp-path = `/`.
    CLEAR ls_exp-contributors.
    ls_contributor-template_line = 5.
    ls_contributor-path = `/`.
    APPEND ls_contributor TO ls_exp-contributors.
    APPEND ls_exp TO lt_exp.
    cl_abap_unit_assert=>assert_equals( exp = lt_exp act = ls_result-trace ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = lines( ls_result-lines ) ).
  ENDMETHOD.

  METHOD trace_value_keeps_tag_line.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lt_contributors TYPE zcl_osd_tpl=>tt_contributions.
    DATA ls_contributor TYPE zcl_osd_tpl=>ty_contribution.
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{v}}`
      ii_data     = data( `{"v":"a\nb"}` ) ).
    cl_abap_unit_assert=>assert_equals( exp = 2 act = lines( ls_result-trace ) ).
    ls_contributor-template = `main`.
    ls_contributor-template_line = 1.
    ls_contributor-path = `/v`.
    ls_contributor-invocation = 1.
    APPEND ls_contributor TO lt_contributors.
    LOOP AT ls_result-trace INTO ls_trace.
      cl_abap_unit_assert=>assert_equals( exp = lt_contributors act = ls_trace-contributors ).
      cl_abap_unit_assert=>assert_equals( exp = 1 act = ls_trace-template_line ).
      cl_abap_unit_assert=>assert_equals( exp = `/v` act = ls_trace-path ).
    ENDLOOP.
  ENDMETHOD.

  METHOD probes_erased_when_off.
    DATA lv_template TYPE string.
    lv_template = `METHOD m.` && nl( )
      && `{{#trace.section}}` && nl( )
      && `  probe( 'enter' ).` && nl( )
      && `{{/trace.section}}` && nl( )
      && `  work( ).` && nl( )
      && `ENDMETHOD.`.
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  work( ).` && nl( ) && `ENDMETHOD.`
      act = text( iv_template = lv_template iv_json = `{"trace":{"section":false}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  probe( 'enter' ).` && nl( ) && `  work( ).` && nl( ) && `ENDMETHOD.`
      act = text( iv_template = lv_template iv_json = `{"trace":{"section":true}}` ) ).
  ENDMETHOD.

  METHOD deterministic.
    DATA lv_first TYPE string.
    lv_first = text( iv_template = `{{#a}}{{x}}-{{/a}}{{b}}` iv_json = `{"a":[{"x":1},{"x":2}],"b":"z"}` ).
    cl_abap_unit_assert=>assert_equals( exp = `1-2-z` act = lv_first ).
    cl_abap_unit_assert=>assert_equals(
      exp = lv_first
      act = text( iv_template = `{{#a}}{{x}}-{{/a}}{{b}}` iv_json = `{"a":[{"x":1},{"x":2}],"b":"z"}` ) ).
  ENDMETHOD.

  METHOD html_escape_only_on_request.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    cl_abap_unit_assert=>assert_equals(
      exp = `IF a < b AND c > "d".`
      act = text( iv_template = `IF {{cond}}.` iv_json = `{"cond":"a < b AND c > \"d\""}` ) ).
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{v}}|{{{v}}}|{{& v}}`
      ii_data     = data( `{"v":"<&>"}` )
      iv_escape   = zcl_osd_tpl=>c_escape-html ).
    cl_abap_unit_assert=>assert_equals(
      exp = `&lt;&amp;&gt;|<&>|<&>`
      act = zcl_osd_tpl=>to_string( ls_result ) ).
  ENDMETHOD.

  METHOD xml_escape_all_five.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{v}}|{{{v}}}|{{& v}}`
      ii_data     = data( `{"v":"&<>\"'"}` )
      iv_escape   = zcl_osd_tpl=>c_escape-xml ).
    cl_abap_unit_assert=>assert_equals(
      exp = `&amp;&lt;&gt;&quot;&apos;|&<>"'|&<>"'`
      act = zcl_osd_tpl=>to_string( ls_result ) ).
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{v}}`
      ii_data     = data( `{"v":"'"}` )
      iv_escape   = zcl_osd_tpl=>c_escape-html ).
    cl_abap_unit_assert=>assert_equals(
      exp = `'`
      act = zcl_osd_tpl=>to_string( ls_result ) ).
  ENDMETHOD.

  METHOD tag_whitespace.
    cl_abap_unit_assert=>assert_equals(
      exp = `OK`
      act = text( iv_template = `{{` && tab( ) && `v` && tab( ) && `}}` iv_json = `{"v":"OK"}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: invalid tag name "a b"`
      act = error_text( iv_template = `{{a b}}` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD loop_first_last_index.
    cl_abap_unit_assert=>assert_equals(
      exp = `1:a, 2:b, 3:c`
      act = text( iv_template = `{{#n}}{{@index}}:{{.}}{{^@last}}, {{/@last}}{{/n}}`
                  iv_json     = `{"n":["a","b","c"]}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `INTO a APPENDING b APPENDING c`
      act = text( iv_template = `{{#n}}{{#@first}}INTO{{/@first}}{{^@first}} APPENDING{{/@first}} {{.}}{{/n}}`
                  iv_json     = `{"n":["a","b","c"]}` ) ).
  ENDMETHOD.

  METHOD filters.
    cl_abap_unit_assert=>assert_equals(
      exp = `AB|ab   |zcl_x`
      act = text( iv_template = `{{name | upper}}|{{name | pad 5}}|{{cls | lower}}`
                  iv_json     = `{"name":"ab","cls":"ZCL_X"}` ) ).
  ENDMETHOD.

  METHOD unknown_filter_is_error.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: unknown filter "shout"`
      act = error_text( iv_template = `{{name | shout}}` iv_json = `{"name":"ab"}` ) ).
  ENDMETHOD.

  METHOD literal_char.
    cl_abap_unit_assert=>assert_equals(
      exp = `'O''Brien'`
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"O'Brien","x@type":{"built_in":"CHAR","length":7}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `'0123'|'20260930'|'123456'`
      act = text( iv_template = `{{n | literal}}|{{d | literal}}|{{t | literal}}`
                  iv_json = `{"n":"0123","n@type":{"built_in":"NUMC","length":4},"d":"20260930","d@type":{"built_in":"DATS","length":8},"t":"123456","t@type":{"built_in":"TIMS","length":6}}` ) ).
  ENDMETHOD.

  METHOD literal_string.
    cl_abap_unit_assert=>assert_equals(
      exp = |`a``b`|
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"a` && |`| && `b","x@type":{"built_in":"SSTR","length":3}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = |`long`|
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"long","x@type":{"built_in":"STRG"}}` ) ).
  ENDMETHOD.

  METHOD literal_integer.
    cl_abap_unit_assert=>assert_equals(
      exp = `255|-32768|-2147483648|9223372036854775807`
      act = text( iv_template = `{{a | literal}}|{{b | literal}}|{{c | literal}}|{{d | literal}}`
                  iv_json = `{"a":"255","a@type":{"built_in":"INT1"},"b":"-32768","b@type":{"built_in":"INT2"},"c":"-2147483648","c@type":{"built_in":"INT4"},"d":"9223372036854775807","d@type":{"built_in":"INT8"}}` ) ).
  ENDMETHOD.

  METHOD literal_decimal.
    cl_abap_unit_assert=>assert_equals(
      exp = `'12.34'|'-3.5'|'0'`
      act = text( iv_template = `{{a | literal}}|{{b | literal}}|{{c | literal}}`
                  iv_json = `{"a":"12.34","a@type":{"built_in":"DEC","length":5,"decimals":2},"b":"-3.5","b@type":{"built_in":"CURR","length":4,"decimals":2},"c":"0","c@type":{"built_in":"QUAN","length":3,"decimals":0}}` ) ).
  ENDMETHOD.

  METHOD literal_raw.
    cl_abap_unit_assert=>assert_equals(
      exp = `'0A1B'`
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"0a1b","x@type":{"built_in":"RAW","length":2}}` ) ).
  ENDMETHOD.

  METHOD literal_missing_type.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:3: literal needs x@type`
      act = error_text( iv_template = `a` && nl( ) && `b` && nl( ) && `{{x | literal}}`
                        iv_json = `{"x":"a"}` ) ).
  ENDMETHOD.

  METHOD literal_missing_value.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal needs x@type`
      act = error_text( iv_template = `{{x | literal}}` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD literal_absent_with_type.
    cl_abap_unit_assert=>assert_equals(
      exp = `[]`
      act = text( iv_template = `[{{x | literal}}]`
                  iv_json = `{"x@type":{"built_in":"CHAR","length":3}}` ) ).
  ENDMETHOD.

  METHOD literal_unknown_type.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal does not know FLTP`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":1,"x@type":{"built_in":"FLTP"}}` ) ).
  ENDMETHOD.

  METHOD literal_char_length.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"abcd","x@type":{"built_in":"CHAR","length":3}}` ) ).
  ENDMETHOD.

  METHOD literal_numc_digits.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs digits`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"12A","x@type":{"built_in":"NUMC","length":3}}` ) ).
  ENDMETHOD.

  METHOD literal_dats_digits.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs 8 digits`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"2026ABCD","x@type":{"built_in":"DATS","length":8}}` ) ).
    " digits only, but seven of them: the count check alone must refuse it
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs 8 digits`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"2026093","x@type":{"built_in":"DATS","length":8}}` ) ).
  ENDMETHOD.

  METHOD literal_tims_digits.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs 6 digits`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"12AB56","x@type":{"built_in":"TIMS","length":6}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs 6 digits`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"12345","x@type":{"built_in":"TIMS","length":6}}` ) ).
  ENDMETHOD.

  METHOD literal_sstr_length.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"abcd","x@type":{"built_in":"SSTR","length":3}}` ) ).
    " a length given as 0 is a length, not an absent one
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"a","x@type":{"built_in":"SSTR","length":0}}` ) ).
  ENDMETHOD.

  METHOD literal_integer_range.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"256","x@type":{"built_in":"INT1"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"32768","x@type":{"built_in":"INT2"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"2147483648","x@type":{"built_in":"INT4"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"-9223372036854775809","x@type":{"built_in":"INT8"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"-1","x@type":{"built_in":"INT1"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs an integer in range`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"9223372036854775808","x@type":{"built_in":"INT8"}}` ) ).
  ENDMETHOD.

  METHOD literal_decimal_number.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs a decimal number`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"12x","x@type":{"built_in":"DEC","length":4,"decimals":2}}` ) ).
  ENDMETHOD.

  METHOD literal_decimal_precision.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds precision`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"12.345","x@type":{"built_in":"DEC","length":6,"decimals":2}}` ) ).
  ENDMETHOD.

  METHOD literal_decimal_digits.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds precision`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"123.45","x@type":{"built_in":"DEC","length":4,"decimals":2}}` ) ).
  ENDMETHOD.

  METHOD literal_raw_hex.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs even hex within length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"0A1G","x@type":{"built_in":"RAW","length":2}}` ) ).
  ENDMETHOD.

  METHOD literal_raw_odd.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs even hex within length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"0A1","x@type":{"built_in":"RAW","length":2}}` ) ).
  ENDMETHOD.

  METHOD literal_raw_length.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs even hex within length`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"0A1B","x@type":{"built_in":"RAW","length":1}}` ) ).
  ENDMETHOD.

  METHOD literal_argument.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: filter literal takes no argument`
      act = error_text( iv_template = `{{x | literal 2}}`
                        iv_json = `{"x":"a","x@type":{"built_in":"CHAR","length":1}}` ) ).
  ENDMETHOD.

  METHOD literal_composition.
    cl_abap_unit_assert=>assert_equals(
      exp = `'AB'`
      act = text( iv_template = `{{x | upper | literal}}`
                  iv_json = `{"x":"ab","x@type":{"built_in":"CHAR","length":2}}` ) ).
  ENDMETHOD.

  METHOD unclosed_section_is_error.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:2: section a not closed`
      act = error_text( iv_template = `line1` && nl( ) && `{{#a}}x` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD unclosed_tag_names_template.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: tag not closed`
      act = error_text( iv_template = `{{v` iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD array_of_eleven_in_order.
    cl_abap_unit_assert=>assert_equals(
      exp = `1 2 3 4 5 6 7 8 9 10 11 `
      act = text( iv_template = `{{#n}}{{.}} {{/n}}` iv_json = `{"n":[1,2,3,4,5,6,7,8,9,10,11]}` ) ).
  ENDMETHOD.


  METHOD lone_cr_at_end_kept.
    cl_abap_unit_assert=>assert_equals(
      exp = cl_abap_char_utilities=>cr_lf(1)
      act = text( iv_template = `{{!c}}` && cl_abap_char_utilities=>cr_lf(1) iv_json = `{}` ) ).
  ENDMETHOD.

  METHOD inline_partial_not_indented.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    lt_partials = partial( iv_name = `p` iv_template = `{{v}}{{>q}}` ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `b` ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `  a` && nl( ) && `bEND`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END` iv_json = `{"v":"a\n"}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD inline_return_not_indented.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    lt_partials = partial( iv_name = `p` iv_template = `{{>q}}X` ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `{{v}}` ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = nl( ) && `XEND`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END` iv_json = `{"v":"\n"}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD newline_value_claims_path.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    ls_result = zcl_osd_tpl=>render(
      iv_template = `X{{v}}{{w}}`
      ii_data     = data( `{"v":"\n","w":"b"}` ) ).
    READ TABLE ls_result-trace INDEX 1 INTO ls_trace.
    cl_abap_unit_assert=>assert_equals( exp = `/v` act = ls_trace-path ).
    READ TABLE ls_result-trace INDEX 2 INTO ls_trace.
    cl_abap_unit_assert=>assert_equals( exp = `/w` act = ls_trace-path ).
  ENDMETHOD.

  METHOD missing_partial_at_limit.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    DATA lv_i TYPE i.
    DATA lv_template TYPE string.
    DO 50 TIMES.
      lv_i = sy-index - 1.
      IF lv_i < 49.
        lv_template = |{ '{{' }>p{ lv_i + 1 }{ '}}' }|.
      ELSE.
        lv_template = `{{>missing}}.`.
      ENDIF.
      APPEND LINES OF partial( iv_name = |p{ lv_i }| iv_template = lv_template ) TO lt_partials.
    ENDDO.
    cl_abap_unit_assert=>assert_equals(
      exp = `.`
      act = text( iv_template = `{{>p0}}` iv_json = `{}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD arguments_are_inherited.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    " a partial without arguments sees its caller's arguments
    lt_partials = partial( iv_name = `p` iv_template = `{{>q}}` ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `{{x}}` ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `bound`
      act = text( iv_template = `{{>p x=a}}` iv_json = `{"x":"root","a":"bound"}` it_partials = lt_partials ) ).
    " forwarded and renamed, and dotted through the alias
    CLEAR lt_partials.
    lt_partials = partial( iv_name = `p` iv_template = `{{>q y=x}}` ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `{{y.name}}/{{x.name}}` ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `in/in`
      act = text( iv_template = `{{>p x=o}}` iv_json = `{"o":{"name":"in"},"x":{"name":"out"}}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD shadowed_first_segment.
    cl_abap_unit_assert=>assert_equals(
      exp = ``
      act = text( iv_template = `{{#a}}{{b.c}}{{/a}}` iv_json = `{"b":{"c":"outer"},"a":{"b":{}}}` ) ).
  ENDMETHOD.

  METHOD nested_loop_metadata.
    cl_abap_unit_assert=>assert_equals(
      exp = `1/true/false;2/false/true;`
      act = text( iv_template = `{{#n}}{{#o}}{{@index}}/{{@first}}/{{@last}};{{/o}}{{/n}}`
                  iv_json     = `{"n":[{"o":{"k":1}},{"o":{"k":2}}]}` ) ).
  ENDMETHOD.

  METHOD filters_checked_without_value.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: unknown filter "shout"`
      act = error_text( iv_template = `{{missing | shout}}` iv_json = `{}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: filter upper takes no argument`
      act = error_text( iv_template = `{{v | upper junk}}` iv_json = `{"v":"a"}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: filter pad needs one width from 1 to 255`
      act = error_text( iv_template = `{{v | pad 2147483648}}` iv_json = `{"v":"a"}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: filter pad needs one width from 1 to 255`
      act = error_text( iv_template = `{{v | pad 256}}` iv_json = `{"v":"a"}` ) ).
  ENDMETHOD.

  METHOD utf8_passes_through.
    " Text is characters, not bytes: a comment, a value and a filter outside
    " 7-bit ASCII come out unchanged, and pad counts characters. The source
    " itself stays 7-bit ASCII, so the text is built from its UTF-8 bytes.
    DATA lv_kaefer TYPE string.
    DATA lv_zhuk   TYPE string.
    DATA lv_upper  TYPE string.
    DATA lv_lower  TYPE string.
    lv_kaefer = `" K` && utf8( `C3A4` ) && `fer f` && utf8( `C3BC` ) && `r `.
    lv_zhuk   = utf8( `D096D183D0BA` ).
    lv_upper  = utf8( `D096D0A3D09A` ).
    lv_lower  = utf8( `D0B6D183D0BA` ).
    cl_abap_unit_assert=>assert_equals(
      exp = lv_kaefer && lv_zhuk && `: ` && lv_upper && `|` && lv_lower && `  |`
      act = text( iv_template = lv_kaefer && `{{name}}: {{name | upper}}|{{low | pad 5}}|`
                  iv_json     = `{"name":"` && lv_zhuk && `","low":"` && lv_lower && `"}` ) ).
  ENDMETHOD.

  METHOD utf8.
    rv = cl_abap_codepage=>convert_from( source = iv_hex ).
  ENDMETHOD.


  METHOD inline_return_after_literal.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    lt_partials = partial( iv_name = `p` iv_template = `{{>q}}X` ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `a` && nl( ) ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `  a` && nl( ) && `XEND`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END` iv_json = `{}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD inline_empty_keeps_indent.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    " an inline partial that writes nothing leaves the line's indentation in place
    lt_partials = partial( iv_name = `p` iv_template = `{{>q}}X` && nl( ) ).
    APPEND LINES OF partial( iv_name = `q` iv_template = `` ) TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `  X` && nl( ) && `END`
      act = text( iv_template = `  {{>p}}` && nl( ) && `END` iv_json = `{}` it_partials = lt_partials ) ).
  ENDMETHOD.

  METHOD literal_not_scalar.
    " an object, an array and null are refused rather than printed as ''
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs a text or a number`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":{"a":1},"x@type":{"built_in":"CHAR","length":3}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs a text or a number`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":[1],"x@type":{"built_in":"CHAR","length":3}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x needs a text or a number`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":null,"x@type":{"built_in":"CHAR","length":3}}` ) ).
  ENDMETHOD.

  METHOD literal_one_source_literal.
    DATA lv_json TYPE string.
    " a line break cannot stand inside an ABAP literal
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x cannot be one ABAP literal: it has a line break`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"a\nb","x@type":{"built_in":"STRG"}}` ) ).
    " 255 characters fit, 256 do not
    lv_json = `{"x":"` && repeat( val = `a` occ = 255 ) && `","x@type":{"built_in":"STRG"}}`.
    cl_abap_unit_assert=>assert_equals(
      exp = `|` && repeat( val = `a` occ = 255 ) && `|`
      act = replace( val = text( iv_template = `{{x | literal}}` iv_json = lv_json ) sub = '`' with = `|` occ = 0 ) ).
    lv_json = `{"x":"` && repeat( val = `a` occ = 256 ) && `","x@type":{"built_in":"STRG"}}`.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x cannot be one ABAP literal: longer than 255 characters`
      act = error_text( iv_template = `{{x | literal}}` iv_json = lv_json ) ).
    " doubling the quotes counts: 200 quote characters become 400
    lv_json = `{"x":"` && repeat( val = `'` occ = 200 ) && `","x@type":{"built_in":"CHAR","length":200}}`.
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x cannot be one ABAP literal: longer than 255 characters`
      act = error_text( iv_template = `{{x | literal}}` iv_json = lv_json ) ).
  ENDMETHOD.

  METHOD literal_normal_numbers.
    " leading zeroes are dropped: 32 zeroes are 0, not a 32-digit literal
    cl_abap_unit_assert=>assert_equals(
      exp = `0`
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"` && repeat( val = `0` occ = 32 ) && `","x@type":{"built_in":"INT4"}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `-42`
      act = text( iv_template = `{{x | literal}}` iv_json = `{"x":"-0042","x@type":{"built_in":"INT2"}}` ) ).
    " DEC 5,2 keeps two places for decimals: 123 fits, 1234 does not
    cl_abap_unit_assert=>assert_equals(
      exp = `'123.45'`
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"123.45","x@type":{"built_in":"DEC","length":5,"decimals":2}}` ) ).
    cl_abap_unit_assert=>assert_equals(
      exp = `main:1: literal x exceeds precision`
      act = error_text( iv_template = `{{x | literal}}`
                        iv_json = `{"x":"1234","x@type":{"built_in":"DEC","length":5,"decimals":2}}` ) ).
    " decimals may equal the length: DEC 2,2 holds 0.12
    cl_abap_unit_assert=>assert_equals(
      exp = `'0.12'`
      act = text( iv_template = `{{x | literal}}`
                  iv_json = `{"x":"0.12","x@type":{"built_in":"DEC","length":2,"decimals":2}}` ) ).
  ENDMETHOD.

ENDCLASS.
