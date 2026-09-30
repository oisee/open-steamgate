CLASS zcl_osd_tpl DEFINITION PUBLIC FINAL CREATE PRIVATE.
* A Mustache-style template engine for generating code, with a trace: every
* output line knows the template, the template line and the data path it came
* from (docs/abap-templates.md). Logic-less: decisions belong to the model.
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
        lines         TYPE string_table,
        trace         TYPE tt_trace,
        final_newline TYPE abap_bool,
      END OF ty_result.

    CONSTANTS:
      BEGIN OF c_escape,
        none TYPE string VALUE 'none',
        html TYPE string VALUE 'html',
      END OF c_escape.

    CONSTANTS c_max_depth TYPE i VALUE 50.

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
        kind       TYPE c LENGTH 1,
        name       TYPE string,
        start      TYPE i,
        end        TYPE i,
        close      TYPE i,
        indent     TYPE string,
        standalone TYPE abap_bool,
      END OF ty_token,
      tt_tokens TYPE STANDARD TABLE OF ty_token WITH DEFAULT KEY,
      tt_offsets TYPE STANDARD TABLE OF i WITH DEFAULT KEY,
      BEGIN OF ty_parsed,
        name        TYPE string,
        is_main     TYPE abap_bool,
        source      TYPE string,
        tokens      TYPE tt_tokens,
        line_starts TYPE tt_offsets,
      END OF ty_parsed,
      tt_parsed TYPE STANDARD TABLE OF ty_parsed WITH DEFAULT KEY,
      BEGIN OF ty_range,
        from TYPE i,
        to   TYPE i,
      END OF ty_range,
      tt_ranges TYPE STANDARD TABLE OF ty_range WITH DEFAULT KEY,
      BEGIN OF ty_alias,
        name TYPE string,
        path TYPE string,
      END OF ty_alias,
      tt_aliases TYPE STANDARD TABLE OF ty_alias WITH DEFAULT KEY,
      BEGIN OF ty_frame,
        path    TYPE string,
        index   TYPE i,
        count   TYPE i,
        aliases TYPE tt_aliases,
      END OF ty_frame,
      tt_frames TYPE STANDARD TABLE OF ty_frame WITH DEFAULT KEY,
      BEGIN OF ty_ref,
        found  TYPE abap_bool,
        path   TYPE string,
        is_meta TYPE abap_bool,
        text   TYPE string,
        truthy TYPE abap_bool,
      END OF ty_ref.

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
    DATA mv_path_from_value TYPE abap_bool.
    DATA mv_pending_indent TYPE string.
    DATA mv_last_newline TYPE abap_bool.
    DATA mv_depth TYPE i.

    METHODS parse
      IMPORTING
        iv_name          TYPE string
        iv_source        TYPE string
        iv_main          TYPE abap_bool
      RETURNING
        VALUE(rv_index)  TYPE i
      RAISING
        zcx_osd_tpl.

    METHODS tokenize
      IMPORTING
        iv_name          TYPE string
        iv_source        TYPE string
        it_line_starts   TYPE tt_offsets
      RETURNING
        VALUE(rt_tokens) TYPE tt_tokens
      RAISING
        zcx_osd_tpl.

    METHODS mark_standalone
      IMPORTING
        iv_source TYPE string
      CHANGING
        ct_tokens TYPE tt_tokens.

    METHODS match_sections
      IMPORTING
        iv_name        TYPE string
        it_line_starts TYPE tt_offsets
      CHANGING
        ct_tokens      TYPE tt_tokens
      RAISING
        zcx_osd_tpl.

    METHODS partial_index
      IMPORTING
        iv_name         TYPE string
      RETURNING
        VALUE(rv_index) TYPE i
      RAISING
        zcx_osd_tpl.

    METHODS render_range
      IMPORTING
        iv_tpl    TYPE i
        iv_from   TYPE i
        iv_to     TYPE i
        it_frames TYPE tt_frames
        iv_indent TYPE string
      RAISING
        zcx_osd_tpl.

    METHODS emit_static
      IMPORTING
        iv_tpl    TYPE i
        iv_from   TYPE i
        iv_to     TYPE i
        iv_path   TYPE string
        iv_indent TYPE string.

    METHODS emit_value
      IMPORTING
        iv_text     TYPE string
        iv_template TYPE string
        iv_line     TYPE i
        iv_path     TYPE string.

    METHODS put_text
      IMPORTING
        iv_text     TYPE string
        iv_template TYPE string
        iv_line     TYPE i
        iv_path     TYPE string
        iv_is_value TYPE abap_bool.

    METHODS end_line
      IMPORTING
        iv_template TYPE string
        iv_line     TYPE i
        iv_path     TYPE string.

    METHODS resolve
      IMPORTING
        iv_name       TYPE string
        it_frames     TYPE tt_frames
      RETURNING
        VALUE(rs_ref) TYPE ty_ref.

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

    METHODS apply_filters
      IMPORTING
        iv_text        TYPE string
        it_filters     TYPE string_table
        iv_where       TYPE string
      RETURNING
        VALUE(rv_text) TYPE string
      RAISING
        zcx_osd_tpl.

    METHODS escape
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS join
      IMPORTING
        iv_path        TYPE string
        iv_name        TYPE string
      RETURNING
        VALUE(rv_path) TYPE string.

    CLASS-METHODS line_of
      IMPORTING
        it_line_starts TYPE tt_offsets
        iv_offset      TYPE i
      RETURNING
        VALUE(rv_line) TYPE i.

    CLASS-METHODS trim
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS is_blank
      IMPORTING
        iv_text       TYPE string
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.

    CLASS-METHODS has_space
      IMPORTING
        iv_text       TYPE string
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.

    CLASS-METHODS split_words
      IMPORTING
        iv_text         TYPE string
      RETURNING
        VALUE(rt_words) TYPE string_table.
ENDCLASS.



CLASS zcl_osd_tpl IMPLEMENTATION.

  METHOD render.
    DATA lo_tpl TYPE REF TO zcl_osd_tpl.
    DATA lv_tpl TYPE i.
    DATA lt_frames TYPE tt_frames.
    DATA ls_frame TYPE ty_frame.
    DATA lv_count TYPE i.
    FIELD-SYMBOLS <ls_tpl> TYPE ty_parsed.

    CREATE OBJECT lo_tpl.
    lo_tpl->mi_data = ii_data.
    lo_tpl->mt_partials = it_partials.
    lo_tpl->mv_escape = iv_escape.

    lv_tpl = lo_tpl->parse( iv_name = iv_name iv_source = iv_template iv_main = abap_true ).
    READ TABLE lo_tpl->mt_parsed INDEX lv_tpl ASSIGNING <ls_tpl>.
    lv_count = lines( <ls_tpl>-tokens ).

    ls_frame-path = `/`.
    APPEND ls_frame TO lt_frames.
    lo_tpl->render_range(
      iv_tpl    = lv_tpl
      iv_from   = 1
      iv_to     = lv_count
      it_frames = lt_frames
      iv_indent = `` ).

    IF lo_tpl->mv_current IS NOT INITIAL OR lo_tpl->mv_traced = abap_true.
      lo_tpl->end_line( iv_template = iv_name iv_line = 0 iv_path = `/` ).
      rs_result-final_newline = abap_false.
    ELSEIF lo_tpl->mt_lines IS NOT INITIAL.
      rs_result-final_newline = lo_tpl->mv_last_newline.
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
    IF is_result-final_newline = abap_true.
      rv_text = rv_text && cl_abap_char_utilities=>newline.
    ENDIF.
  ENDMETHOD.


  METHOD parse.
    DATA ls_parsed TYPE ty_parsed.
    DATA lv_pos TYPE i.
    DATA lv_nl TYPE i.

    ls_parsed-name = iv_name.
    ls_parsed-is_main = iv_main.
    ls_parsed-source = iv_source.
    APPEND 0 TO ls_parsed-line_starts.
    lv_nl = find( val = iv_source sub = cl_abap_char_utilities=>newline off = lv_pos ).
    WHILE lv_nl >= 0.
      lv_pos = lv_nl + 1.
      APPEND lv_pos TO ls_parsed-line_starts.
      lv_nl = find( val = iv_source sub = cl_abap_char_utilities=>newline off = lv_pos ).
    ENDWHILE.

    ls_parsed-tokens = tokenize( iv_name        = iv_name
                                 iv_source      = iv_source
                                 it_line_starts = ls_parsed-line_starts ).
    match_sections( EXPORTING iv_name        = iv_name
                              it_line_starts = ls_parsed-line_starts
                    CHANGING  ct_tokens      = ls_parsed-tokens ).
    APPEND ls_parsed TO mt_parsed.
    rv_index = lines( mt_parsed ).
  ENDMETHOD.


  METHOD tokenize.
* Tags only; the static text between them is cut out of the source by
* mark_standalone, which needs the original offsets.
    DATA lv_len TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_open TYPE i.
    DATA lv_close TYPE i.
    DATA lv_tag TYPE string.
    DATA lv_triple TYPE abap_bool.
    DATA lv_line TYPE i.
    DATA lv_base TYPE string.
    DATA lv_bar TYPE i.
    DATA ls_token TYPE ty_token.
    DATA lt_words TYPE string_table.

    lv_len = strlen( iv_source ).
    WHILE lv_pos < lv_len.
      " find( ) and not FIND IN SECTION ... LENGTH: ANOMALY-2026-09-30-find-section-length
      lv_open = find( val = iv_source sub = `{{` off = lv_pos ).
      IF lv_open < 0.
        EXIT.
      ENDIF.
      lv_line = line_of( it_line_starts = it_line_starts iv_offset = lv_open ).

      lv_triple = abap_false.
      IF lv_open + 2 < lv_len AND substring( val = iv_source off = lv_open len = 3 ) = `{{{`.
        lv_triple = abap_true.
        lv_close = find( val = iv_source sub = `}}}` off = lv_open ).
      ELSE.
        lv_close = find( val = iv_source sub = `}}` off = lv_open ).
      ENDIF.
      IF lv_close < 0.
        RAISE EXCEPTION TYPE zcx_osd_tpl
          EXPORTING
            text = |{ iv_name }:{ lv_line }: tag not closed|.
      ENDIF.

      CLEAR ls_token.
      ls_token-start = lv_open.
      IF lv_triple = abap_true.
        ls_token-kind = c_kind-raw.
        lv_tag = substring( val = iv_source off = lv_open + 3 len = lv_close - lv_open - 3 ).
        ls_token-end = lv_close + 3.
      ELSE.
        lv_tag = substring( val = iv_source off = lv_open + 2 len = lv_close - lv_open - 2 ).
        ls_token-end = lv_close + 2.
      ENDIF.
      lv_pos = ls_token-end.

      lv_tag = trim( lv_tag ).
      IF lv_triple = abap_false AND lv_tag IS NOT INITIAL.
        CASE lv_tag(1).
          WHEN c_kind-section OR c_kind-inverted OR c_kind-close OR c_kind-comment
              OR c_kind-partial OR c_kind-raw.
            ls_token-kind = lv_tag(1).
            lv_tag = trim( substring( val = lv_tag off = 1 ) ).
          WHEN OTHERS.
            ls_token-kind = c_kind-var.
        ENDCASE.
      ENDIF.
      ls_token-name = lv_tag.

      IF ls_token-kind <> c_kind-comment.
        " the name proper: before a filter bar for values, before arguments for partials
        lv_base = lv_tag.
        IF ls_token-kind = c_kind-var OR ls_token-kind = c_kind-raw.
          lv_bar = find( val = lv_tag sub = `|` ).
          IF lv_bar >= 0.
            lv_base = trim( substring( val = lv_tag len = lv_bar ) ).
          ENDIF.
        ELSEIF ls_token-kind = c_kind-partial.
          lt_words = split_words( lv_tag ).
          READ TABLE lt_words INDEX 1 INTO lv_base.
        ENDIF.
        IF lv_base IS INITIAL OR has_space( lv_base ) = abap_true.
          RAISE EXCEPTION TYPE zcx_osd_tpl
            EXPORTING
              text = |{ iv_name }:{ lv_line }: invalid tag name "{ lv_tag }"|.
        ENDIF.
      ENDIF.
      APPEND ls_token TO rt_tokens.
    ENDWHILE.

    mark_standalone( EXPORTING iv_source = iv_source CHANGING ct_tokens = rt_tokens ).
  ENDMETHOD.


  METHOD mark_standalone.
* A section, inverted, close, comment or partial tag alone on its line (only
* blanks around it, no other tag) takes the whole line with it, newline
* included (Mustache spec, "standalone"). Judged on the original source, so
* consecutive standalone lines and CRLF work; the cut ranges become the gaps
* the static text is not taken from.
    DATA lv_len TYPE i.
    DATA lv_index TYPE i.
    DATA lv_ls TYPE i.
    DATA lv_le TYPE i.
    DATA lv_nl TYPE i.
    DATA lv_before TYPE string.
    DATA lv_after TYPE string.
    DATA lv_alone TYPE abap_bool.
    DATA lv_prev_start TYPE i.
    DATA lt_cuts TYPE tt_ranges.
    DATA ls_cut TYPE ty_range.
    DATA lt_out TYPE tt_tokens.
    DATA ls_static TYPE ty_token.
    DATA lv_from TYPE i.
    DATA lv_to TYPE i.
    DATA lv_piece_from TYPE i.
    FIELD-SYMBOLS <ls_token> TYPE ty_token.
    FIELD-SYMBOLS <ls_other> TYPE ty_token.

    lv_len = strlen( iv_source ).
    LOOP AT ct_tokens ASSIGNING <ls_token>.
      lv_index = sy-tabix.
      IF <ls_token>-kind = c_kind-var OR <ls_token>-kind = c_kind-raw.
        CONTINUE.
      ENDIF.

      " line start: after the last newline before the tag
      lv_ls = 0.
      lv_nl = find( val = iv_source sub = cl_abap_char_utilities=>newline off = lv_ls ).
      WHILE lv_nl >= 0 AND lv_nl < <ls_token>-start.
        lv_ls = lv_nl + 1.
        lv_nl = find( val = iv_source sub = cl_abap_char_utilities=>newline off = lv_ls ).
      ENDWHILE.
      " line end: the next newline at or after the tag's end
      lv_le = find( val = iv_source sub = cl_abap_char_utilities=>newline off = <ls_token>-end ).
      IF lv_le < 0.
        lv_le = lv_len.
      ENDIF.

      lv_before = substring( val = iv_source off = lv_ls len = <ls_token>-start - lv_ls ).
      lv_after = substring( val = iv_source off = <ls_token>-end len = lv_le - <ls_token>-end ).
      IF strlen( lv_after ) > 0 AND substring( val = lv_after off = strlen( lv_after ) - 1 ) = cl_abap_char_utilities=>cr_lf(1).
        lv_after = substring( val = lv_after len = strlen( lv_after ) - 1 ).
      ENDIF.
      IF is_blank( lv_before ) = abap_false OR is_blank( lv_after ) = abap_false.
        CONTINUE.
      ENDIF.

      lv_alone = abap_true.
      LOOP AT ct_tokens ASSIGNING <ls_other>.
        IF sy-tabix <> lv_index AND <ls_other>-start < lv_le AND <ls_other>-end > lv_ls.
          lv_alone = abap_false.
          EXIT.
        ENDIF.
      ENDLOOP.
      IF lv_alone = abap_false.
        CONTINUE.
      ENDIF.

      <ls_token>-standalone = abap_true.
      IF <ls_token>-kind = c_kind-partial.
        <ls_token>-indent = lv_before.
      ENDIF.
      ls_cut-from = lv_ls.
      IF lv_le < lv_len.
        ls_cut-to = lv_le + 1.
      ELSE.
        ls_cut-to = lv_len.
      ENDIF.
      APPEND ls_cut TO lt_cuts.
    ENDLOOP.

    " static pieces: the source between tags, minus the cut ranges
    lv_prev_start = 0.
    LOOP AT ct_tokens ASSIGNING <ls_token>.
      lv_from = lv_prev_start.
      lv_to = <ls_token>-start.
      lv_piece_from = lv_from.
      LOOP AT lt_cuts INTO ls_cut WHERE to > lv_from AND from < lv_to.
        IF ls_cut-from > lv_piece_from.
          CLEAR ls_static.
          ls_static-kind = c_kind-static.
          ls_static-start = lv_piece_from.
          ls_static-end = ls_cut-from.
          APPEND ls_static TO lt_out.
        ENDIF.
        IF ls_cut-to > lv_piece_from.
          lv_piece_from = ls_cut-to.
        ENDIF.
      ENDLOOP.
      IF lv_piece_from < lv_to.
        CLEAR ls_static.
        ls_static-kind = c_kind-static.
        ls_static-start = lv_piece_from.
        ls_static-end = lv_to.
        APPEND ls_static TO lt_out.
      ENDIF.
      APPEND <ls_token> TO lt_out.
      lv_prev_start = <ls_token>-end.
      " a cut that reaches past this tag moves the next static start
      LOOP AT lt_cuts INTO ls_cut WHERE from < lv_prev_start AND to > lv_prev_start.
        lv_prev_start = ls_cut-to.
      ENDLOOP.
    ENDLOOP.

    lv_from = lv_prev_start.
    lv_piece_from = lv_from.
    LOOP AT lt_cuts INTO ls_cut WHERE to > lv_from AND from < lv_len.
      IF ls_cut-from > lv_piece_from.
        CLEAR ls_static.
        ls_static-kind = c_kind-static.
        ls_static-start = lv_piece_from.
        ls_static-end = ls_cut-from.
        APPEND ls_static TO lt_out.
      ENDIF.
      IF ls_cut-to > lv_piece_from.
        lv_piece_from = ls_cut-to.
      ENDIF.
    ENDLOOP.
    IF lv_piece_from < lv_len.
      CLEAR ls_static.
      ls_static-kind = c_kind-static.
      ls_static-start = lv_piece_from.
      ls_static-end = lv_len.
      APPEND ls_static TO lt_out.
    ENDIF.

    ct_tokens = lt_out.
  ENDMETHOD.


  METHOD match_sections.
    DATA lt_open TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_open TYPE i.
    DATA lv_count TYPE i.
    DATA lv_index TYPE i.
    DATA lv_line TYPE i.
    FIELD-SYMBOLS <ls_token> TYPE ty_token.
    FIELD-SYMBOLS <ls_open> TYPE ty_token.

    LOOP AT ct_tokens ASSIGNING <ls_token>.
      lv_index = sy-tabix.
      CASE <ls_token>-kind.
        WHEN c_kind-section OR c_kind-inverted.
          APPEND lv_index TO lt_open.
        WHEN c_kind-close.
          lv_line = line_of( it_line_starts = it_line_starts iv_offset = <ls_token>-start ).
          lv_count = lines( lt_open ).
          IF lv_count = 0.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_name }:{ lv_line }: close tag { <ls_token>-name } without open|.
          ENDIF.
          READ TABLE lt_open INDEX lv_count INTO lv_open.
          DELETE lt_open INDEX lv_count.
          READ TABLE ct_tokens INDEX lv_open ASSIGNING <ls_open>.
          IF <ls_open>-name <> <ls_token>-name.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_name }:{ lv_line }: close tag { <ls_token>-name } for { <ls_open>-name }|.
          ENDIF.
          <ls_open>-close = lv_index.
      ENDCASE.
    ENDLOOP.

    IF lt_open IS NOT INITIAL.
      READ TABLE lt_open INDEX 1 INTO lv_open.
      READ TABLE ct_tokens INDEX lv_open ASSIGNING <ls_open>.
      lv_line = line_of( it_line_starts = it_line_starts iv_offset = <ls_open>-start ).
      RAISE EXCEPTION TYPE zcx_osd_tpl
        EXPORTING
          text = |{ iv_name }:{ lv_line }: section { <ls_open>-name } not closed|.
    ENDIF.
  ENDMETHOD.


  METHOD partial_index.
* The main template is never a partial, even when a partial has its name.
    DATA ls_partial TYPE ty_partial.
    FIELD-SYMBOLS <ls_tpl> TYPE ty_parsed.

    LOOP AT mt_parsed ASSIGNING <ls_tpl> WHERE name = iv_name AND is_main = abap_false.
      rv_index = sy-tabix.
      RETURN.
    ENDLOOP.
    READ TABLE mt_partials INTO ls_partial WITH KEY name = iv_name.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    rv_index = parse( iv_name = iv_name iv_source = ls_partial-template iv_main = abap_false ).
  ENDMETHOD.


  METHOD render_range.
    DATA lv_index TYPE i.
    DATA ls_token TYPE ty_token.
    DATA ls_ref TYPE ty_ref.
    DATA lv_name TYPE string.
    DATA lt_filters TYPE string_table.
    DATA lv_bar TYPE i.
    DATA lv_text TYPE string.
    DATA lv_line TYPE i.
    DATA lv_where TYPE string.
    DATA lv_type TYPE zif_ajson_types=>ty_node_type.
    DATA lt_inner TYPE tt_frames.
    DATA ls_frame TYPE ty_frame.
    DATA lv_item TYPE i.
    DATA lv_count TYPE i.
    DATA lv_partial TYPE i.
    DATA lv_partial_count TYPE i.
    DATA lt_words TYPE string_table.
    DATA lv_word TYPE string.
    DATA ls_alias TYPE ty_alias.
    DATA lv_eq TYPE i.
    DATA ls_arg TYPE ty_ref.
    DATA lv_indent TYPE string.
    DATA lv_template TYPE string.
    FIELD-SYMBOLS <ls_tpl> TYPE ty_parsed.
    FIELD-SYMBOLS <ls_top> TYPE ty_frame.

    READ TABLE mt_parsed INDEX iv_tpl ASSIGNING <ls_tpl>.
    lv_template = <ls_tpl>-name.
    READ TABLE it_frames INDEX lines( it_frames ) ASSIGNING <ls_top>.

    lv_index = iv_from.
    WHILE lv_index <= iv_to.
      READ TABLE <ls_tpl>-tokens INDEX lv_index INTO ls_token.
      lv_line = line_of( it_line_starts = <ls_tpl>-line_starts iv_offset = ls_token-start ).
      lv_where = |{ lv_template }:{ lv_line }|.

      CASE ls_token-kind.
        WHEN c_kind-static.
          emit_static( iv_tpl    = iv_tpl
                       iv_from   = ls_token-start
                       iv_to     = ls_token-end
                       iv_path   = <ls_top>-path
                       iv_indent = iv_indent ).

        WHEN c_kind-var OR c_kind-raw.
          lv_name = ls_token-name.
          CLEAR lt_filters.
          lv_bar = find( val = lv_name sub = `|` ).
          IF lv_bar >= 0.
            lv_text = substring( val = lv_name off = lv_bar + 1 ).
            SPLIT lv_text AT `|` INTO TABLE lt_filters.
            lv_name = trim( substring( val = lv_name len = lv_bar ) ).
          ENDIF.
          ls_ref = resolve( iv_name = lv_name it_frames = it_frames ).
          IF ls_ref-found = abap_true.
            IF ls_ref-is_meta = abap_true.
              lv_text = ls_ref-text.
            ELSE.
              lv_text = value_text( ls_ref-path ).
            ENDIF.
            lv_text = apply_filters( iv_text = lv_text it_filters = lt_filters iv_where = lv_where ).
            IF ls_token-kind = c_kind-var.
              lv_text = escape( lv_text ).
            ENDIF.
            emit_value( iv_text     = lv_text
                        iv_template = lv_template
                        iv_line     = lv_line
                        iv_path     = ls_ref-path ).
          ENDIF.

        WHEN c_kind-section.
          ls_ref = resolve( iv_name = ls_token-name it_frames = it_frames ).
          IF ls_ref-found = abap_true AND ls_ref-truthy = abap_true.
            IF ls_ref-is_meta = abap_false.
              lv_type = mi_data->get_node_type( ls_ref-path ).
            ELSE.
              CLEAR lv_type.
            ENDIF.
            IF lv_type = zif_ajson_types=>node_type-array.
              lv_count = 0.
              WHILE mi_data->exists( join( iv_path = ls_ref-path iv_name = |{ lv_count + 1 }| ) ) = abap_true.
                lv_count = lv_count + 1.
              ENDWHILE.
              DO lv_count TIMES.
                lv_item = sy-index.
                lt_inner = it_frames.
                CLEAR ls_frame.
                ls_frame-path = join( iv_path = ls_ref-path iv_name = |{ lv_item }| ).
                ls_frame-index = lv_item.
                ls_frame-count = lv_count.
                APPEND ls_frame TO lt_inner.
                render_range( iv_tpl    = iv_tpl
                              iv_from   = lv_index + 1
                              iv_to     = ls_token-close - 1
                              it_frames = lt_inner
                              iv_indent = iv_indent ).
              ENDDO.
            ELSE.
              lt_inner = it_frames.
              IF ls_ref-is_meta = abap_false.
                CLEAR ls_frame.
                ls_frame-path = ls_ref-path.
                APPEND ls_frame TO lt_inner.
              ENDIF.
              render_range( iv_tpl    = iv_tpl
                            iv_from   = lv_index + 1
                            iv_to     = ls_token-close - 1
                            it_frames = lt_inner
                            iv_indent = iv_indent ).
            ENDIF.
          ENDIF.
          lv_index = ls_token-close.

        WHEN c_kind-inverted.
          ls_ref = resolve( iv_name = ls_token-name it_frames = it_frames ).
          IF ls_ref-found = abap_false OR ls_ref-truthy = abap_false.
            render_range( iv_tpl    = iv_tpl
                          iv_from   = lv_index + 1
                          iv_to     = ls_token-close - 1
                          it_frames = it_frames
                          iv_indent = iv_indent ).
          ENDIF.
          lv_index = ls_token-close.

        WHEN c_kind-partial.
          lt_words = split_words( ls_token-name ).
          READ TABLE lt_words INDEX 1 INTO lv_word.
          IF mv_depth >= c_max_depth.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ lv_where }: partials nested deeper than { c_max_depth }|.
          ENDIF.
          lv_partial = partial_index( lv_word ).
          IF lv_partial > 0.
            " arguments name=path bind names for the partial
            lt_inner = it_frames.
            CLEAR ls_frame.
            ls_frame-path = <ls_top>-path.
            ls_frame-index = <ls_top>-index.
            ls_frame-count = <ls_top>-count.
            LOOP AT lt_words INTO lv_word FROM 2.
              lv_eq = find( val = lv_word sub = `=` ).
              IF lv_eq <= 0.
                RAISE EXCEPTION TYPE zcx_osd_tpl
                  EXPORTING
                    text = |{ lv_where }: partial argument "{ lv_word }" is not name=path|.
              ENDIF.
              ls_arg = resolve( iv_name = substring( val = lv_word off = lv_eq + 1 ) it_frames = it_frames ).
              IF ls_arg-found = abap_false OR ls_arg-is_meta = abap_true.
                RAISE EXCEPTION TYPE zcx_osd_tpl
                  EXPORTING
                    text = |{ lv_where }: partial argument "{ lv_word }" not found|.
              ENDIF.
              ls_alias-name = substring( val = lv_word len = lv_eq ).
              ls_alias-path = ls_arg-path.
              APPEND ls_alias TO ls_frame-aliases.
            ENDLOOP.
            APPEND ls_frame TO lt_inner.
            READ TABLE mt_parsed INDEX lv_partial ASSIGNING <ls_tpl>.
            lv_partial_count = lines( <ls_tpl>-tokens ).
            lv_indent = iv_indent && ls_token-indent.
            IF mv_current IS INITIAL.
              mv_pending_indent = lv_indent.
            ENDIF.
            mv_depth = mv_depth + 1.
            render_range( iv_tpl    = lv_partial
                          iv_from   = 1
                          iv_to     = lv_partial_count
                          it_frames = lt_inner
                          iv_indent = lv_indent ).
            mv_depth = mv_depth - 1.
            " back in the caller: its own indentation, not the partial's
            IF mv_current IS INITIAL.
              mv_pending_indent = iv_indent.
            ENDIF.
            READ TABLE mt_parsed INDEX iv_tpl ASSIGNING <ls_tpl>.
          ENDIF.

        WHEN OTHERS.
          " comment, close: nothing
      ENDCASE.

      lv_index = lv_index + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD emit_static.
* Literal source text: a newline ends the output line, and the next line of a
* partial starts with the partial's indentation (not blank lines: no trailing
* blanks in generated code).
    DATA lv_pos TYPE i.
    DATA lv_nl TYPE i.
    DATA lv_part TYPE string.
    DATA lv_line TYPE i.
    FIELD-SYMBOLS <ls_tpl> TYPE ty_parsed.

    READ TABLE mt_parsed INDEX iv_tpl ASSIGNING <ls_tpl>.
    lv_pos = iv_from.
    WHILE lv_pos < iv_to.
      lv_line = line_of( it_line_starts = <ls_tpl>-line_starts iv_offset = lv_pos ).
      lv_nl = find( val = <ls_tpl>-source sub = cl_abap_char_utilities=>newline off = lv_pos ).
      IF lv_nl < 0 OR lv_nl >= iv_to.
        lv_part = substring( val = <ls_tpl>-source off = lv_pos len = iv_to - lv_pos ).
        put_text( iv_text = lv_part iv_template = <ls_tpl>-name iv_line = lv_line
                  iv_path = iv_path iv_is_value = abap_false ).
        EXIT.
      ENDIF.
      lv_part = substring( val = <ls_tpl>-source off = lv_pos len = lv_nl - lv_pos ).
      put_text( iv_text = lv_part iv_template = <ls_tpl>-name iv_line = lv_line
                iv_path = iv_path iv_is_value = abap_false ).
      end_line( iv_template = <ls_tpl>-name iv_line = lv_line iv_path = iv_path ).
      mv_pending_indent = iv_indent.
      lv_pos = lv_nl + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD emit_value.
* A value's own newlines end output lines too, but every piece keeps the tag's
* line, and continuation lines of a value are not indented.
    DATA lv_pos TYPE i.
    DATA lv_nl TYPE i.
    DATA lv_len TYPE i.

    lv_len = strlen( iv_text ).
    WHILE lv_pos <= lv_len.
      lv_nl = find( val = iv_text sub = cl_abap_char_utilities=>newline off = lv_pos ).
      IF lv_nl < 0.
        put_text( iv_text = substring( val = iv_text off = lv_pos )
                  iv_template = iv_template iv_line = iv_line iv_path = iv_path iv_is_value = abap_true ).
        EXIT.
      ENDIF.
      put_text( iv_text = substring( val = iv_text off = lv_pos len = lv_nl - lv_pos )
                iv_template = iv_template iv_line = iv_line iv_path = iv_path iv_is_value = abap_true ).
      end_line( iv_template = iv_template iv_line = iv_line iv_path = iv_path ).
      lv_pos = lv_nl + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD put_text.
* The first text of a line opens its trace entry; the first value on the line
* then names the path (the node the line is about).
    DATA ls_trace TYPE ty_trace.
    FIELD-SYMBOLS <ls_trace> TYPE ty_trace.

    IF iv_text IS INITIAL.
      RETURN.
    ENDIF.
    IF mv_traced = abap_false.
      ls_trace-line = lines( mt_lines ) + 1.
      ls_trace-template = iv_template.
      ls_trace-template_line = iv_line.
      ls_trace-path = iv_path.
      APPEND ls_trace TO mt_trace.
      mv_traced = abap_true.
      mv_path_from_value = iv_is_value.
      mv_current = mv_pending_indent && mv_current.
      CLEAR mv_pending_indent.
    ELSEIF iv_is_value = abap_true AND mv_path_from_value = abap_false.
      READ TABLE mt_trace INDEX lines( mt_trace ) ASSIGNING <ls_trace>.
      <ls_trace>-path = iv_path.
      mv_path_from_value = abap_true.
    ENDIF.
    mv_current = mv_current && iv_text.
    mv_last_newline = abap_false.
  ENDMETHOD.


  METHOD end_line.
    DATA ls_trace TYPE ty_trace.

    IF mv_traced = abap_false.
      ls_trace-line = lines( mt_lines ) + 1.
      ls_trace-template = iv_template.
      ls_trace-template_line = iv_line.
      ls_trace-path = iv_path.
      APPEND ls_trace TO mt_trace.
    ENDIF.
    APPEND mv_current TO mt_lines.
    CLEAR mv_current.
    CLEAR mv_pending_indent.
    mv_traced = abap_false.
    mv_path_from_value = abap_false.
    mv_last_newline = abap_true.
  ENDMETHOD.


  METHOD resolve.
* "." is the current context; "@index", "@first", "@last" describe the nearest
* loop (1-based, like sy-tabix); a dotted name finds its first part in the
* nearest frame that has it (an alias of a partial argument or a member of the
* frame's node), then walks down from there.
    DATA lt_segments TYPE string_table.
    DATA lv_first TYPE string.
    DATA lv_index TYPE i.
    DATA lv_candidate TYPE string.
    DATA lv_segment TYPE string.
    DATA ls_alias TYPE ty_alias.
    FIELD-SYMBOLS <ls_frame> TYPE ty_frame.

    IF iv_name = `.`.
      READ TABLE it_frames INDEX lines( it_frames ) ASSIGNING <ls_frame>.
      rs_ref-found = abap_true.
      rs_ref-path = <ls_frame>-path.
      rs_ref-truthy = is_truthy( rs_ref-path ).
      RETURN.
    ENDIF.

    IF iv_name = `@index` OR iv_name = `@first` OR iv_name = `@last`.
      lv_index = lines( it_frames ).
      WHILE lv_index > 0.
        READ TABLE it_frames INDEX lv_index ASSIGNING <ls_frame>.
        IF <ls_frame>-index > 0.
          rs_ref-found = abap_true.
          rs_ref-is_meta = abap_true.
          rs_ref-path = <ls_frame>-path.
          CASE iv_name.
            WHEN `@index`.
              rs_ref-text = |{ <ls_frame>-index }|.
              rs_ref-truthy = abap_true.
            WHEN `@first`.
              IF <ls_frame>-index = 1.
                rs_ref-truthy = abap_true.
              ENDIF.
            WHEN `@last`.
              IF <ls_frame>-index = <ls_frame>-count.
                rs_ref-truthy = abap_true.
              ENDIF.
          ENDCASE.
          IF iv_name <> `@index`.
            IF rs_ref-truthy = abap_true.
              rs_ref-text = `true`.
            ELSE.
              rs_ref-text = `false`.
            ENDIF.
          ENDIF.
          RETURN.
        ENDIF.
        lv_index = lv_index - 1.
      ENDWHILE.
      RETURN.
    ENDIF.

    SPLIT iv_name AT `.` INTO TABLE lt_segments.
    READ TABLE lt_segments INDEX 1 INTO lv_first.
    lv_index = lines( it_frames ).
    WHILE lv_index > 0.
      READ TABLE it_frames INDEX lv_index ASSIGNING <ls_frame>.
      READ TABLE <ls_frame>-aliases INTO ls_alias WITH KEY name = lv_first.
      IF sy-subrc = 0.
        lv_candidate = ls_alias-path.
        EXIT.
      ENDIF.
      lv_candidate = join( iv_path = <ls_frame>-path iv_name = lv_first ).
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
      lv_candidate = join( iv_path = lv_candidate iv_name = lv_segment ).
      IF mi_data->exists( lv_candidate ) = abap_false.
        RETURN.
      ENDIF.
    ENDLOOP.
    rs_ref-found = abap_true.
    rs_ref-path = lv_candidate.
    rs_ref-truthy = is_truthy( lv_candidate ).
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
* JSON truthiness: false, null, an empty array and an empty string are false;
* numbers (0 too) and objects are true.
    DATA lv_type TYPE zif_ajson_types=>ty_node_type.

    lv_type = mi_data->get_node_type( iv_path ).
    CASE lv_type.
      WHEN zif_ajson_types=>node_type-null.
        rv_yes = abap_false.
      WHEN zif_ajson_types=>node_type-boolean.
        rv_yes = mi_data->get_boolean( iv_path ).
      WHEN zif_ajson_types=>node_type-array.
        rv_yes = mi_data->exists( join( iv_path = iv_path iv_name = `1` ) ).
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


  METHOD apply_filters.
* lower, upper, pad <n> (blanks on the right up to n characters).
    DATA lv_filter TYPE string.
    DATA lt_words TYPE string_table.
    DATA lv_name TYPE string.
    DATA lv_arg TYPE string.
    DATA lv_width TYPE i.

    rv_text = iv_text.
    LOOP AT it_filters INTO lv_filter.
      lt_words = split_words( lv_filter ).
      CLEAR: lv_name, lv_arg.
      READ TABLE lt_words INDEX 1 INTO lv_name.
      READ TABLE lt_words INDEX 2 INTO lv_arg.
      CASE lv_name.
        WHEN `lower`.
          rv_text = to_lower( rv_text ).
        WHEN `upper`.
          rv_text = to_upper( rv_text ).
        WHEN `pad`.
          IF lv_arg IS INITIAL OR lv_arg CN `0123456789`.
            RAISE EXCEPTION TYPE zcx_osd_tpl
              EXPORTING
                text = |{ iv_where }: filter pad needs a width|.
          ENDIF.
          lv_width = lv_arg.
          WHILE strlen( rv_text ) < lv_width.
            rv_text = rv_text && ` `.
          ENDWHILE.
        WHEN OTHERS.
          RAISE EXCEPTION TYPE zcx_osd_tpl
            EXPORTING
              text = |{ iv_where }: unknown filter "{ lv_name }"|.
      ENDCASE.
    ENDLOOP.
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


  METHOD join.
    IF iv_path = `/`.
      rv_path = `/` && iv_name.
    ELSE.
      rv_path = iv_path && `/` && iv_name.
    ENDIF.
  ENDMETHOD.


  METHOD line_of.
    DATA lv_start TYPE i.

    LOOP AT it_line_starts INTO lv_start.
      IF lv_start > iv_offset.
        EXIT.
      ENDIF.
      rv_line = sy-tabix.
    ENDLOOP.
  ENDMETHOD.


  METHOD trim.
* Blanks, tabs, CR and LF off both ends; nothing inside is touched.
    DATA lv_from TYPE i.
    DATA lv_to TYPE i.
    DATA lv_ws TYPE string.

    lv_ws = ` ` && cl_abap_char_utilities=>horizontal_tab && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>cr_lf(1).
    lv_to = strlen( iv_text ).
    WHILE lv_from < lv_to AND substring( val = iv_text off = lv_from len = 1 ) CA lv_ws.
      lv_from = lv_from + 1.
    ENDWHILE.
    WHILE lv_to > lv_from AND substring( val = iv_text off = lv_to - 1 len = 1 ) CA lv_ws.
      lv_to = lv_to - 1.
    ENDWHILE.
    rv_text = substring( val = iv_text off = lv_from len = lv_to - lv_from ).
  ENDMETHOD.


  METHOD is_blank.
    DATA lv_blank TYPE string.

    lv_blank = ` ` && cl_abap_char_utilities=>horizontal_tab.
    IF iv_text IS INITIAL OR iv_text CO lv_blank.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.


  METHOD has_space.
    DATA lv_ws TYPE string.

    lv_ws = ` ` && cl_abap_char_utilities=>horizontal_tab && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>cr_lf(1).
    IF iv_text CA lv_ws.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.


  METHOD split_words.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA lv_text TYPE string.

    lv_text = iv_text.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN lv_text WITH ` `.
    SPLIT lv_text AT ` ` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      IF lv_part IS NOT INITIAL.
        APPEND lv_part TO rt_words.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
