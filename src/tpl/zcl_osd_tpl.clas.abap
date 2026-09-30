CLASS zcl_osd_tpl DEFINITION PUBLIC FINAL CREATE PRIVATE.
* A Mustache subset for generating code, with a trace: every output line
* knows the template line and the data path it came from (docs/abap-templates.md).
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_partial,
        name     TYPE string,
        template TYPE string,
      END OF ty_partial,
      tt_partials TYPE STANDARD TABLE OF ty_partial WITH DEFAULT KEY,
      BEGIN OF ty_trace,
        line          TYPE i,
        template      TYPE string,
        template_line TYPE i,
        path          TYPE string,
      END OF ty_trace,
      tt_trace TYPE STANDARD TABLE OF ty_trace WITH DEFAULT KEY,
      BEGIN OF ty_result,
        lines TYPE string_table,
        trace TYPE tt_trace,
      END OF ty_result.

    CONSTANTS:
      BEGIN OF c_escape,
        none TYPE string VALUE 'none',
        html TYPE string VALUE 'html',
      END OF c_escape.

    CLASS-METHODS render
      IMPORTING
        iv_template      TYPE string
        ii_data          TYPE REF TO zif_ajson
        it_partials      TYPE tt_partials OPTIONAL
        iv_name          TYPE string DEFAULT 'main'
        iv_escape        TYPE string DEFAULT c_escape-none
      RETURNING
        VALUE(rs_result) TYPE ty_result
      RAISING
        zcx_osd_tpl.

    CLASS-METHODS to_string
      IMPORTING
        is_result      TYPE ty_result
      RETURNING
        VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_token,
        kind   TYPE c LENGTH 1,
        text   TYPE string,
        name   TYPE string,
        line   TYPE i,
        indent TYPE string,
        close  TYPE i,
      END OF ty_token,
      tt_tokens TYPE STANDARD TABLE OF ty_token WITH DEFAULT KEY,
      BEGIN OF ty_parsed,
        name   TYPE string,
        tokens TYPE tt_tokens,
      END OF ty_parsed,
      tt_parsed TYPE STANDARD TABLE OF ty_parsed WITH DEFAULT KEY.

    CONSTANTS:
      BEGIN OF c_kind,
        static   TYPE c LENGTH 1 VALUE 'S',
        var      TYPE c LENGTH 1 VALUE 'V',
        raw      TYPE c LENGTH 1 VALUE '&',
        section  TYPE c LENGTH 1 VALUE '#',
        inverted TYPE c LENGTH 1 VALUE '^',
        close    TYPE c LENGTH 1 VALUE '/',
        comment  TYPE c LENGTH 1 VALUE '!',
        partial  TYPE c LENGTH 1 VALUE '>',
      END OF c_kind.

    DATA mi_data TYPE REF TO zif_ajson.
    DATA mt_partials TYPE tt_partials.
    DATA mt_parsed TYPE tt_parsed.
    DATA mv_escape TYPE string.
    DATA mt_lines TYPE string_table.
    DATA mt_trace TYPE tt_trace.
    DATA mv_current TYPE string.
    DATA mv_traced TYPE abap_bool.
    DATA mv_depth TYPE i.

    METHODS tokenize
      IMPORTING
        iv_template      TYPE string
      RETURNING
        VALUE(rt_tokens) TYPE tt_tokens
      RAISING
        zcx_osd_tpl.

    METHODS mark_standalone
      CHANGING
        ct_tokens TYPE tt_tokens.

    METHODS match_sections
      IMPORTING
        iv_name   TYPE string
      CHANGING
        ct_tokens TYPE tt_tokens
      RAISING
        zcx_osd_tpl.

    METHODS parsed
      IMPORTING
        iv_name          TYPE string
      RETURNING
        VALUE(rt_tokens) TYPE tt_tokens
      RAISING
        zcx_osd_tpl.

    METHODS render_range
      IMPORTING
        iv_name    TYPE string
        it_tokens  TYPE tt_tokens
        iv_from    TYPE i
        iv_to      TYPE i
        it_context TYPE string_table
        iv_indent  TYPE string
      RAISING
        zcx_osd_tpl.

    METHODS emit
      IMPORTING
        iv_text     TYPE string
        iv_template TYPE string
        iv_line     TYPE i
        iv_path     TYPE string
        iv_indent   TYPE string.

    METHODS new_line.

    METHODS resolve
      IMPORTING
        iv_name        TYPE string
        it_context     TYPE string_table
      RETURNING
        VALUE(rv_path) TYPE string.

    METHODS value_text
      IMPORTING
        iv_path        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    METHODS is_truthy
      IMPORTING
        iv_path       TYPE string
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.

    METHODS escape
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS context_path
      IMPORTING
        it_context     TYPE string_table
      RETURNING
        VALUE(rv_path) TYPE string.
ENDCLASS.



CLASS zcl_osd_tpl IMPLEMENTATION.

  METHOD render.
    DATA lo_tpl TYPE REF TO zcl_osd_tpl.
    DATA lt_tokens TYPE tt_tokens.
    DATA lt_context TYPE string_table.
    DATA ls_parsed TYPE ty_parsed.

    CREATE OBJECT lo_tpl.
    lo_tpl->mi_data = ii_data.
    lo_tpl->mt_partials = it_partials.
    lo_tpl->mv_escape = iv_escape.

    lt_tokens = lo_tpl->tokenize( iv_template ).
    lo_tpl->match_sections( EXPORTING iv_name = iv_name CHANGING ct_tokens = lt_tokens ).
    ls_parsed-name = iv_name.
    ls_parsed-tokens = lt_tokens.
    APPEND ls_parsed TO lo_tpl->mt_parsed.

    APPEND `/` TO lt_context.
    lo_tpl->render_range(
      iv_name    = iv_name
      it_tokens  = lt_tokens
      iv_from    = 1
      iv_to      = lines( lt_tokens )
      it_context = lt_context
      iv_indent  = `` ).

    IF lo_tpl->mv_current IS NOT INITIAL OR lo_tpl->mv_traced = abap_true.
      lo_tpl->new_line( ).
    ENDIF.

    rs_result-lines = lo_tpl->mt_lines.
    rs_result-trace = lo_tpl->mt_trace.
  ENDMETHOD.


  METHOD to_string.
    DATA lv_line TYPE string.

    LOOP AT is_result-lines INTO lv_line.
      IF sy-tabix > 1.
        rv_text = rv_text && cl_abap_char_utilities=>newline.
      ENDIF.
      rv_text = rv_text && lv_line.
    ENDLOOP.
  ENDMETHOD.


  METHOD tokenize.
    DATA lv_len TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_open TYPE i.
    DATA lv_close TYPE i.
    DATA lv_line TYPE i VALUE 1.
    DATA lv_count TYPE i.
    DATA lv_tag TYPE string.
    DATA lv_triple TYPE abap_bool.
    DATA ls_token TYPE ty_token.

    lv_len = strlen( iv_template ).
    WHILE lv_pos < lv_len.
      " find( ) and not FIND IN SECTION ... LENGTH: ANOMALY-2026-09-30-find-section-length
      lv_open = find( val = iv_template sub = `{{` off = lv_pos ).
      IF lv_open < 0.
        lv_open = lv_len.
      ENDIF.

      IF lv_open > lv_pos.
        CLEAR ls_token.
        ls_token-kind = c_kind-static.
        ls_token-text = substring( val = iv_template off = lv_pos len = lv_open - lv_pos ).
        ls_token-line = lv_line.
        APPEND ls_token TO rt_tokens.
        FIND ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN ls_token-text MATCH COUNT lv_count.
        lv_line = lv_line + lv_count.
      ENDIF.
      IF lv_open >= lv_len.
        EXIT.
      ENDIF.

      lv_triple = abap_false.
      IF lv_open + 2 < lv_len AND iv_template+lv_open(3) = `{{{`.
        lv_triple = abap_true.
      ENDIF.
      IF lv_triple = abap_true.
        lv_close = find( val = iv_template sub = `}}}` off = lv_open ).
      ELSE.
        lv_close = find( val = iv_template sub = `}}` off = lv_open ).
      ENDIF.
      IF lv_close < 0.
        RAISE EXCEPTION TYPE zcx_osd_tpl
          EXPORTING
            text = |Unclosed tag at line { lv_line }|.
      ENDIF.

      CLEAR ls_token.
      ls_token-line = lv_line.
      IF lv_triple = abap_true.
        ls_token-kind = c_kind-raw.
        lv_tag = substring( val = iv_template off = lv_open + 3 len = lv_close - lv_open - 3 ).
        lv_pos = lv_close + 3.
      ELSE.
        lv_tag = substring( val = iv_template off = lv_open + 2 len = lv_close - lv_open - 2 ).
        lv_pos = lv_close + 2.
        CONDENSE lv_tag.
        IF lv_tag IS INITIAL.
          RAISE EXCEPTION TYPE zcx_osd_tpl
            EXPORTING
              text = |Empty tag at line { lv_line }|.
        ENDIF.
        CASE lv_tag(1).
          WHEN c_kind-section OR c_kind-inverted OR c_kind-close OR c_kind-comment
              OR c_kind-partial OR c_kind-raw.
            ls_token-kind = lv_tag(1).
            lv_tag = substring( val = lv_tag off = 1 ).
          WHEN OTHERS.
            ls_token-kind = c_kind-var.
        ENDCASE.
      ENDIF.
      CONDENSE lv_tag.
      ls_token-name = lv_tag.
      IF ls_token-kind = c_kind-comment.
        FIND ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_tag MATCH COUNT lv_count.
        lv_line = lv_line + lv_count.
      ENDIF.
      APPEND ls_token TO rt_tokens.
    ENDWHILE.

    mark_standalone( CHANGING ct_tokens = rt_tokens ).
  ENDMETHOD.


  METHOD mark_standalone.
* A section, inverted, close, comment or partial tag alone on its line
* leaves no trace of the line: the whitespace before it on the line and the
* newline after it go (Mustache spec, "standalone").
    DATA lv_index TYPE i.
    DATA lv_prev_ok TYPE abap_bool.
    DATA lv_next_ok TYPE abap_bool.
    DATA lv_last_nl TYPE i.
    DATA lv_tail TYPE string.
    DATA lv_head TYPE string.
    DATA lv_nl TYPE i.
    DATA lv_count TYPE i.
    FIELD-SYMBOLS <ls_token> TYPE ty_token.
    FIELD-SYMBOLS <ls_prev> TYPE ty_token.
    FIELD-SYMBOLS <ls_next> TYPE ty_token.

    LOOP AT ct_tokens ASSIGNING <ls_token>.
      lv_index = sy-tabix.
      IF <ls_token>-kind = c_kind-static OR <ls_token>-kind = c_kind-var OR <ls_token>-kind = c_kind-raw.
        CONTINUE.
      ENDIF.

      UNASSIGN <ls_prev>.
      UNASSIGN <ls_next>.
      lv_prev_ok = abap_false.
      lv_next_ok = abap_false.
      CLEAR lv_tail.

      IF lv_index = 1.
        lv_prev_ok = abap_true.
      ELSE.
        READ TABLE ct_tokens INDEX lv_index - 1 ASSIGNING <ls_prev>.
        IF <ls_prev>-kind = c_kind-static.
          FIND ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN <ls_prev>-text MATCH COUNT lv_count.
          IF lv_count > 0.
            FIND ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN <ls_prev>-text MATCH OFFSET lv_last_nl.
            lv_tail = substring( val = <ls_prev>-text off = lv_last_nl + 1 ).
            IF lv_tail CO ` ` && cl_abap_char_utilities=>horizontal_tab OR lv_tail IS INITIAL.
              lv_prev_ok = abap_true.
            ENDIF.
          ELSEIF lv_index = 2 AND ( <ls_prev>-text CO ` ` && cl_abap_char_utilities=>horizontal_tab ).
            lv_tail = <ls_prev>-text.
            lv_prev_ok = abap_true.
          ENDIF.
        ENDIF.
      ENDIF.
      IF lv_prev_ok = abap_false.
        CONTINUE.
      ENDIF.

      READ TABLE ct_tokens INDEX lv_index + 1 ASSIGNING <ls_next>.
      IF sy-subrc <> 0.
        lv_next_ok = abap_true.
      ELSEIF <ls_next>-kind = c_kind-static.
        FIND cl_abap_char_utilities=>newline IN <ls_next>-text MATCH OFFSET lv_nl.
        IF sy-subrc = 0.
          lv_head = substring( val = <ls_next>-text len = lv_nl ).
          IF lv_head IS INITIAL OR lv_head CO ` ` && cl_abap_char_utilities=>horizontal_tab
              OR lv_head = cl_abap_char_utilities=>cr_lf(1).
            lv_next_ok = abap_true.
          ENDIF.
        ELSEIF <ls_next>-text CO ` ` && cl_abap_char_utilities=>horizontal_tab
            AND lv_index + 1 = lines( ct_tokens ).
          lv_nl = strlen( <ls_next>-text ) - 1.
          lv_next_ok = abap_true.
        ENDIF.
      ENDIF.
      IF lv_next_ok = abap_false.
        CONTINUE.
      ENDIF.

      IF <ls_token>-kind = c_kind-partial.
        <ls_token>-indent = lv_tail.
      ENDIF.
      IF <ls_prev> IS ASSIGNED.
        <ls_prev>-text = substring( val = <ls_prev>-text len = strlen( <ls_prev>-text ) - strlen( lv_tail ) ).
      ENDIF.
      IF <ls_next> IS ASSIGNED.
        <ls_next>-text = substring( val = <ls_next>-text off = lv_nl + 1 ).
        <ls_next>-line = <ls_next>-line + 1.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD match_sections.
    DATA lt_open TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_open TYPE i.
    DATA lv_count TYPE i.
    DATA lv_index TYPE i.
    FIELD-SYMBOLS <ls_token> TYPE ty_token.
    FIELD-SYMBOLS <ls_open> TYPE ty_token.

    LOOP AT ct_tokens ASSIGNING <ls_token>.
      lv_index = sy-tabix.
      CASE <ls_token>-kind.
        WHEN c_kind-section OR c_kind-inverted.
          APPEND lv_index TO lt_open.
        WHEN c_kind-close.
          lv_count = lines( lt_open ).
          IF lv_count = 0.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_name }:{ <ls_token>-line }: close tag { <ls_token>-name } without open|.
          ENDIF.
          READ TABLE lt_open INDEX lv_count INTO lv_open.
          DELETE lt_open INDEX lv_count.
          READ TABLE ct_tokens INDEX lv_open ASSIGNING <ls_open>.
          IF <ls_open>-name <> <ls_token>-name.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_name }:{ <ls_token>-line }: close tag { <ls_token>-name } for { <ls_open>-name }|.
          ENDIF.
          <ls_open>-close = lv_index.
      ENDCASE.
    ENDLOOP.

    IF lt_open IS NOT INITIAL.
      READ TABLE lt_open INDEX 1 INTO lv_open.
      READ TABLE ct_tokens INDEX lv_open ASSIGNING <ls_open>.
      RAISE EXCEPTION TYPE zcx_osd_tpl
        EXPORTING
          text = |{ iv_name }:{ <ls_open>-line }: section { <ls_open>-name } not closed|.
    ENDIF.
  ENDMETHOD.


  METHOD parsed.
    DATA ls_parsed TYPE ty_parsed.
    DATA ls_partial TYPE ty_partial.

    READ TABLE mt_parsed INTO ls_parsed WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rt_tokens = ls_parsed-tokens.
      RETURN.
    ENDIF.

    READ TABLE mt_partials INTO ls_partial WITH KEY name = iv_name.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    rt_tokens = tokenize( ls_partial-template ).
    match_sections( EXPORTING iv_name = iv_name CHANGING ct_tokens = rt_tokens ).
    ls_parsed-name = iv_name.
    ls_parsed-tokens = rt_tokens.
    APPEND ls_parsed TO mt_parsed.
  ENDMETHOD.


  METHOD render_range.
    DATA lv_index TYPE i.
    DATA ls_token TYPE ty_token.
    DATA lv_path TYPE string.
    DATA lv_type TYPE zif_ajson_types=>ty_node_type.
    DATA lt_inner TYPE string_table.
    DATA lv_item TYPE i.
    DATA lv_item_path TYPE string.
    DATA lt_partial TYPE tt_tokens.

    lv_index = iv_from.
    WHILE lv_index <= iv_to.
      READ TABLE it_tokens INDEX lv_index INTO ls_token.

      CASE ls_token-kind.
        WHEN c_kind-static.
          emit( iv_text     = ls_token-text
                iv_template = iv_name
                iv_line     = ls_token-line
                iv_path     = context_path( it_context )
                iv_indent   = iv_indent ).

        WHEN c_kind-var OR c_kind-raw.
          lv_path = resolve( iv_name = ls_token-name it_context = it_context ).
          IF lv_path IS NOT INITIAL.
            IF ls_token-kind = c_kind-var.
              emit( iv_text     = escape( value_text( lv_path ) )
                    iv_template = iv_name
                    iv_line     = ls_token-line
                    iv_path     = lv_path
                    iv_indent   = iv_indent ).
            ELSE.
              emit( iv_text     = value_text( lv_path )
                    iv_template = iv_name
                    iv_line     = ls_token-line
                    iv_path     = lv_path
                    iv_indent   = iv_indent ).
            ENDIF.
          ENDIF.

        WHEN c_kind-section.
          lv_path = resolve( iv_name = ls_token-name it_context = it_context ).
          IF lv_path IS NOT INITIAL AND is_truthy( lv_path ) = abap_true.
            lv_type = mi_data->get_node_type( lv_path ).
            IF lv_type = zif_ajson_types=>node_type-array.
              lv_item = 1.
              lv_item_path = |{ lv_path }/{ lv_item }|.
              WHILE mi_data->exists( lv_item_path ) = abap_true.
                lt_inner = it_context.
                APPEND |{ lv_item_path }/| TO lt_inner.
                render_range( iv_name    = iv_name
                              it_tokens  = it_tokens
                              iv_from    = lv_index + 1
                              iv_to      = ls_token-close - 1
                              it_context = lt_inner
                              iv_indent  = iv_indent ).
                lv_item = lv_item + 1.
                lv_item_path = |{ lv_path }/{ lv_item }|.
              ENDWHILE.
            ELSE.
              lt_inner = it_context.
              IF lv_type = zif_ajson_types=>node_type-object.
                APPEND |{ lv_path }/| TO lt_inner.
              ENDIF.
              render_range( iv_name    = iv_name
                            it_tokens  = it_tokens
                            iv_from    = lv_index + 1
                            iv_to      = ls_token-close - 1
                            it_context = lt_inner
                            iv_indent  = iv_indent ).
            ENDIF.
          ENDIF.
          lv_index = ls_token-close.

        WHEN c_kind-inverted.
          lv_path = resolve( iv_name = ls_token-name it_context = it_context ).
          IF lv_path IS INITIAL OR is_truthy( lv_path ) = abap_false.
            render_range( iv_name    = iv_name
                          it_tokens  = it_tokens
                          iv_from    = lv_index + 1
                          iv_to      = ls_token-close - 1
                          it_context = it_context
                          iv_indent  = iv_indent ).
          ENDIF.
          lv_index = ls_token-close.

        WHEN c_kind-partial.
          IF mv_depth > 50.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_name }:{ ls_token-line }: partials nested deeper than 50|.
          ENDIF.
          lt_partial = parsed( ls_token-name ).
          IF lt_partial IS NOT INITIAL.
            mv_depth = mv_depth + 1.
            render_range( iv_name    = ls_token-name
                          it_tokens  = lt_partial
                          iv_from    = 1
                          iv_to      = lines( lt_partial )
                          it_context = it_context
                          iv_indent  = iv_indent && ls_token-indent ).
            mv_depth = mv_depth - 1.
          ENDIF.

        WHEN OTHERS.
          " comment, close: nothing
      ENDCASE.

      lv_index = lv_index + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD emit.
* Text goes into the current line; a newline ends it. The first text of a line
* decides its trace entry, and a partial's indentation starts every line.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA lv_count TYPE i.
    DATA lv_index TYPE i.
    DATA ls_trace TYPE ty_trace.

    IF iv_text IS INITIAL.
      RETURN.
    ENDIF.

    SPLIT iv_text AT cl_abap_char_utilities=>newline INTO TABLE lt_parts.
    lv_count = lines( lt_parts ).
    " SPLIT drops a trailing empty part: a text ending in a newline ends the line
    IF strlen( iv_text ) > 0 AND substring( val = iv_text off = strlen( iv_text ) - 1 ) = cl_abap_char_utilities=>newline.
      APPEND `` TO lt_parts.
      lv_count = lv_count + 1.
    ENDIF.

    LOOP AT lt_parts INTO lv_part.
      lv_index = sy-tabix.
      IF lv_index > 1.
        new_line( ).
      ENDIF.
      IF lv_part IS NOT INITIAL.
        IF mv_traced = abap_false.
          ls_trace-line = lines( mt_lines ) + 1.
          ls_trace-template = iv_template.
          ls_trace-template_line = iv_line + lv_index - 1.
          ls_trace-path = iv_path.
          APPEND ls_trace TO mt_trace.
          mv_traced = abap_true.
          mv_current = iv_indent && mv_current.
        ENDIF.
        mv_current = mv_current && lv_part.
      ELSEIF lv_index < lv_count AND mv_traced = abap_false.
        ls_trace-line = lines( mt_lines ) + 1.
        ls_trace-template = iv_template.
        ls_trace-template_line = iv_line + lv_index - 1.
        ls_trace-path = iv_path.
        APPEND ls_trace TO mt_trace.
        mv_traced = abap_true.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD new_line.
    APPEND mv_current TO mt_lines.
    CLEAR mv_current.
    mv_traced = abap_false.
  ENDMETHOD.


  METHOD resolve.
* Mustache name lookup: "." is the current context; a dotted name finds its
* first part in the nearest context that has it, then walks down from there.
    DATA lt_segments TYPE string_table.
    DATA lv_first TYPE string.
    DATA lv_index TYPE i.
    DATA lv_context TYPE string.
    DATA lv_candidate TYPE string.
    DATA lv_segment TYPE string.

    IF iv_name = `.`.
      rv_path = context_path( it_context ).
      RETURN.
    ENDIF.

    SPLIT iv_name AT `.` INTO TABLE lt_segments.
    READ TABLE lt_segments INDEX 1 INTO lv_first.
    lv_index = lines( it_context ).
    WHILE lv_index > 0.
      READ TABLE it_context INDEX lv_index INTO lv_context.
      lv_candidate = lv_context && lv_first.
      IF mi_data->exists( lv_candidate ) = abap_true.
        EXIT.
      ENDIF.
      CLEAR lv_candidate.
      lv_index = lv_index - 1.
    ENDWHILE.
    IF lv_candidate IS INITIAL.
      RETURN.
    ENDIF.

    LOOP AT lt_segments INTO lv_segment FROM 2.
      lv_candidate = |{ lv_candidate }/{ lv_segment }|.
      IF mi_data->exists( lv_candidate ) = abap_false.
        RETURN.
      ENDIF.
    ENDLOOP.
    rv_path = lv_candidate.
  ENDMETHOD.


  METHOD value_text.
    DATA lv_type TYPE zif_ajson_types=>ty_node_type.

    lv_type = mi_data->get_node_type( iv_path ).
    CASE lv_type.
      WHEN zif_ajson_types=>node_type-string OR zif_ajson_types=>node_type-number.
        rv_text = mi_data->get( iv_path ).
      WHEN zif_ajson_types=>node_type-boolean.
        IF mi_data->get_boolean( iv_path ) = abap_true.
          rv_text = `true`.
        ELSE.
          rv_text = `false`.
        ENDIF.
      WHEN OTHERS.
        CLEAR rv_text.
    ENDCASE.
  ENDMETHOD.


  METHOD is_truthy.
    DATA lv_type TYPE zif_ajson_types=>ty_node_type.

    lv_type = mi_data->get_node_type( iv_path ).
    CASE lv_type.
      WHEN zif_ajson_types=>node_type-null.
        rv_yes = abap_false.
      WHEN zif_ajson_types=>node_type-boolean.
        rv_yes = mi_data->get_boolean( iv_path ).
      WHEN zif_ajson_types=>node_type-array.
        rv_yes = mi_data->exists( |{ iv_path }/1| ).
      WHEN zif_ajson_types=>node_type-string.
        IF mi_data->get( iv_path ) IS INITIAL.
          rv_yes = abap_false.
        ELSE.
          rv_yes = abap_true.
        ENDIF.
      WHEN OTHERS.
        rv_yes = abap_true.
    ENDCASE.
  ENDMETHOD.


  METHOD escape.
    rv_text = iv_text.
    IF mv_escape <> c_escape-html.
      RETURN.
    ENDIF.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
    REPLACE ALL OCCURRENCES OF `"` IN rv_text WITH `&quot;`.
  ENDMETHOD.


  METHOD context_path.
    DATA lv_context TYPE string.
    DATA lv_len TYPE i.

    READ TABLE it_context INDEX lines( it_context ) INTO lv_context.
    lv_len = strlen( lv_context ).
    IF lv_len <= 1.
      rv_path = `/`.
    ELSE.
      rv_path = substring( val = lv_context len = lv_len - 1 ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
