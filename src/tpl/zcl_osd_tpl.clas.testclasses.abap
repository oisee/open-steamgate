CLASS ltcl_osd_tpl DEFINITION FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS interpolation FOR TESTING RAISING cx_static_check.
    METHODS section_over_array FOR TESTING RAISING cx_static_check.
    METHODS standalone_leaves_no_line FOR TESTING RAISING cx_static_check.
    METHODS inverted_and_comment FOR TESTING RAISING cx_static_check.
    METHODS partial_is_indented FOR TESTING RAISING cx_static_check.
    METHODS dotted_names FOR TESTING RAISING cx_static_check.
    METHODS trace_names_line_and_path FOR TESTING RAISING cx_static_check.
    METHODS probes_erased_when_off FOR TESTING RAISING cx_static_check.
    METHODS deterministic FOR TESTING RAISING cx_static_check.
    METHODS html_escape_only_on_request FOR TESTING RAISING cx_static_check.
    METHODS unclosed_section_is_error FOR TESTING.
    METHODS array_of_ten_in_order FOR TESTING RAISING cx_static_check.

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

    METHODS nl
      RETURNING
        VALUE(rv_nl) TYPE string.
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

  METHOD nl.
    rv_nl = cl_abap_char_utilities=>newline.
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

  METHOD partial_is_indented.
    DATA lt_partials TYPE zcl_osd_tpl=>tt_partials.
    DATA ls_partial TYPE zcl_osd_tpl=>ty_partial.
    ls_partial-name = `body`.
    ls_partial-template = `DATA a.` && nl( ) && `DATA b.` && nl( ).
    APPEND ls_partial TO lt_partials.
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  DATA a.` && nl( ) && `  DATA b.` && nl( ) && `ENDMETHOD.`
      act = text( iv_template = `METHOD m.` && nl( ) && `  {{> body}}` && nl( ) && `ENDMETHOD.`
                  iv_json     = `{}`
                  it_partials = lt_partials ) ).
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
  ENDMETHOD.

  METHOD trace_names_line_and_path.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
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

    cl_abap_unit_assert=>assert_equals( exp = 4 act = lines( ls_result-lines ) ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = lines( ls_result-trace ) ).

    READ TABLE ls_result-trace INDEX 3 INTO ls_trace.
    cl_abap_unit_assert=>assert_equals( exp = 3 act = ls_trace-line ).
    cl_abap_unit_assert=>assert_equals( exp = `cls` act = ls_trace-template ).
    cl_abap_unit_assert=>assert_equals( exp = 3 act = ls_trace-template_line ).
    cl_abap_unit_assert=>assert_equals( exp = `/methods/2` act = ls_trace-path ).

    READ TABLE ls_result-trace INDEX 4 INTO ls_trace.
    cl_abap_unit_assert=>assert_equals( exp = 5 act = ls_trace-template_line ).
    cl_abap_unit_assert=>assert_equals( exp = `/` act = ls_trace-path ).
  ENDMETHOD.

  METHOD probes_erased_when_off.
    DATA lv_template TYPE string.
    DATA lv_on TYPE string.
    DATA lv_off TYPE string.
    lv_template = `METHOD m.` && nl( )
      && `{{#trace.section}}` && nl( )
      && `  probe( 'enter' ).` && nl( )
      && `{{/trace.section}}` && nl( )
      && `  work( ).` && nl( )
      && `ENDMETHOD.`.
    lv_on = text( iv_template = lv_template iv_json = `{"trace":{"section":true}}` ).
    lv_off = text( iv_template = lv_template iv_json = `{"trace":{"section":false}}` ).
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  work( ).` && nl( ) && `ENDMETHOD.`
      act = lv_off ).
    cl_abap_unit_assert=>assert_equals(
      exp = `METHOD m.` && nl( ) && `  probe( 'enter' ).` && nl( ) && `  work( ).` && nl( ) && `ENDMETHOD.`
      act = lv_on ).
  ENDMETHOD.

  METHOD deterministic.
    DATA lv_template TYPE string.
    lv_template = `{{#a}}{{x}}-{{/a}}{{b}}`.
    cl_abap_unit_assert=>assert_equals(
      exp = text( iv_template = lv_template iv_json = `{"a":[{"x":1},{"x":2}],"b":"z"}` )
      act = text( iv_template = lv_template iv_json = `{"a":[{"x":1},{"x":2}],"b":"z"}` ) ).
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

  METHOD unclosed_section_is_error.
    DATA lx TYPE REF TO zcx_osd_tpl.
    TRY.
        zcl_osd_tpl=>render(
          iv_template = `line1` && nl( ) && `{{#a}}x`
          ii_data     = zcl_ajson=>create_empty( ) ).
        cl_abap_unit_assert=>fail( `no error for an unclosed section` ).
      CATCH zcx_osd_tpl INTO lx.
        cl_abap_unit_assert=>assert_equals( exp = `main:2: section a not closed` act = lx->text ).
    ENDTRY.
  ENDMETHOD.

  METHOD array_of_ten_in_order.
    cl_abap_unit_assert=>assert_equals(
      exp = `1 2 3 4 5 6 7 8 9 10 11 `
      act = text( iv_template = `{{#n}}{{.}} {{/n}}` iv_json = `{"n":[1,2,3,4,5,6,7,8,9,10,11]}` ) ).
  ENDMETHOD.

ENDCLASS.
