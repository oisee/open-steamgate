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
    METHODS trace_whole_table FOR TESTING RAISING cx_static_check.
    METHODS trace_value_keeps_tag_line FOR TESTING RAISING cx_static_check.
    METHODS probes_erased_when_off FOR TESTING RAISING cx_static_check.
    METHODS deterministic FOR TESTING RAISING cx_static_check.
    METHODS html_escape_only_on_request FOR TESTING RAISING cx_static_check.
    METHODS tag_whitespace FOR TESTING RAISING cx_static_check.
    METHODS loop_first_last_index FOR TESTING RAISING cx_static_check.
    METHODS filters FOR TESTING RAISING cx_static_check.
    METHODS unknown_filter_is_error FOR TESTING.
    METHODS unclosed_section_is_error FOR TESTING.
    METHODS unclosed_tag_names_template FOR TESTING.
    METHODS array_of_eleven_in_order FOR TESTING RAISING cx_static_check.

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

  METHOD trace_whole_table.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA lt_exp TYPE zcl_osd_tpl=>tt_trace.
    DATA ls_exp TYPE zcl_osd_tpl=>ty_trace.
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

    ls_exp-template = `cls`.
    ls_exp-line = 1.
    ls_exp-template_line = 1.
    ls_exp-path = `/`.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 2.
    ls_exp-template_line = 3.
    ls_exp-path = `/methods/1/name`.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 3.
    ls_exp-template_line = 3.
    ls_exp-path = `/methods/2/name`.
    APPEND ls_exp TO lt_exp.
    ls_exp-line = 4.
    ls_exp-template_line = 5.
    ls_exp-path = `/`.
    APPEND ls_exp TO lt_exp.
    cl_abap_unit_assert=>assert_equals( exp = lt_exp act = ls_result-trace ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = lines( ls_result-lines ) ).
  ENDMETHOD.

  METHOD trace_value_keeps_tag_line.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    ls_result = zcl_osd_tpl=>render(
      iv_template = `{{v}}`
      ii_data     = data( `{"v":"a\nb"}` ) ).
    cl_abap_unit_assert=>assert_equals( exp = 2 act = lines( ls_result-trace ) ).
    LOOP AT ls_result-trace INTO ls_trace.
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

ENDCLASS.
