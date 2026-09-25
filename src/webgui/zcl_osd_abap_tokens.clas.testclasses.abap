CLASS ltcl_scan DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The scanner the editor colours with. Each case names the token by where
* it is (line, column, length) and what it is, because that is all the
* screen reads: a token in the wrong place is a coloured half-word.
  PRIVATE SECTION.
    METHODS keywords_and_names FOR TESTING RAISING cx_static_check.
    METHODS comments FOR TESTING RAISING cx_static_check.
    METHODS quoted_literals FOR TESTING RAISING cx_static_check.
    METHODS string_templates FOR TESTING RAISING cx_static_check.
    METHODS pragma_and_field_symbol FOR TESTING RAISING cx_static_check.
    METHODS references_split_words FOR TESTING RAISING cx_static_check.
    METHODS the_list_is_a_word_list FOR TESTING RAISING cx_static_check.
    METHODS tokens_never_overlap FOR TESTING RAISING cx_static_check.

    METHODS assert_token
      IMPORTING
        it_token TYPE zcl_osd_abap_tokens=>tt_token
        iv_line  TYPE i
        iv_col   TYPE i
        iv_len   TYPE i
        iv_kind  TYPE string.
ENDCLASS.

CLASS ltcl_scan IMPLEMENTATION.

  METHOD assert_token.
    DATA ls_token TYPE zosd_token_s.
    DATA lv_kind  TYPE string.

    READ TABLE it_token INTO ls_token WITH KEY line = iv_line col = iv_col.
    cl_abap_unit_assert=>assert_subrc( msg = |no token at { iv_line }:{ iv_col }| ).
    cl_abap_unit_assert=>assert_equals( act = ls_token-len exp = iv_len msg = |length at { iv_line }:{ iv_col }| ).
    lv_kind = ls_token-kind.
    cl_abap_unit_assert=>assert_equals( act = lv_kind exp = iv_kind msg = |kind at { iv_line }:{ iv_col }| ).
  ENDMETHOD.

  METHOD keywords_and_names.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

    lt_token = zcl_osd_abap_tokens=>scan( `CLASS zcl_osd_st05 DEFINITION PUBLIC.` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 1 iv_len = 5 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 7 iv_len = 12 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 20 iv_len = 10 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 31 iv_len = 6 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 37 iv_len = 1 iv_kind = `punct` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_token ) exp = 5 ).

*   case does not matter, and a hyphenated keyword is one word
    lt_token = zcl_osd_abap_tokens=>scan( `  class-methods zap.` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 3 iv_len = 13 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 17 iv_len = 3 iv_kind = `name` ).
  ENDMETHOD.

  METHOD comments.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.
    DATA lv_source TYPE string.

    lv_source = `* a whole line` && cl_abap_char_utilities=>newline &&
                `  DATA x TYPE i. " the rest of this one` && cl_abap_char_utilities=>newline &&
                ` * not in column 1`.
    lt_token = zcl_osd_abap_tokens=>scan( lv_source ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 1 iv_len = 14 iv_kind = `comment` ).
    assert_token( it_token = lt_token iv_line = 2 iv_col = 3 iv_len = 4 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 2 iv_col = 18 iv_len = 22 iv_kind = `comment` ).
*   a star anywhere else is an operator, and the words after it are words
    assert_token( it_token = lt_token iv_line = 3 iv_col = 4 iv_len = 3 iv_kind = `keyword` ).
  ENDMETHOD.

  METHOD quoted_literals.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

*   a doubled quote is the quote, and does not end the literal; a comment
*   character inside one is text
    lt_token = zcl_osd_abap_tokens=>scan( 'x = ''it''''s " no comment''. y = `a``b`.' ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 5 iv_len = 20 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 25 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 31 iv_len = 6 iv_kind = `string` ).

*   an unterminated literal runs to the end of its line and no further
    lt_token = zcl_osd_abap_tokens=>scan( `x = 'open` && cl_abap_char_utilities=>newline && `DATA` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 5 iv_len = 5 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 2 iv_col = 1 iv_len = 4 iv_kind = `keyword` ).
  ENDMETHOD.

  METHOD string_templates.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

*   the text is a string, the embedded expression is code again
    lt_token = zcl_osd_abap_tokens=>scan( 'x = |a\|{ lines( zz ) }b|.' ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 5 iv_len = 4 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 9 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 11 iv_len = 5 iv_kind = `keyword` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 16 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 18 iv_len = 2 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 21 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 23 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 24 iv_len = 2 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 26 iv_len = 1 iv_kind = `punct` ).

*   an empty template, and one that does not close on its line
    lt_token = zcl_osd_abap_tokens=>scan( 'x = ||. y = |open' && cl_abap_char_utilities=>newline && 'DATA' ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 5 iv_len = 2 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 13 iv_len = 5 iv_kind = `string` ).
    assert_token( it_token = lt_token iv_line = 2 iv_col = 1 iv_len = 4 iv_kind = `keyword` ).
  ENDMETHOD.

  METHOD pragma_and_field_symbol.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

    lt_token = zcl_osd_abap_tokens=>scan( `DATA x TYPE i ##NEEDED. ASSIGN y TO <ls_row>.` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 15 iv_len = 8 iv_kind = `pragma` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 23 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 37 iv_len = 8 iv_kind = `name` ).
  ENDMETHOD.

  METHOD references_split_words.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

*   `->` and `=>` end a word; `-` inside one does not
    lt_token = zcl_osd_abap_tokens=>scan( `lo_x->zap( ls_row-field ). zcl_y=>zip( ).` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 1 iv_len = 4 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 7 iv_len = 3 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 10 iv_len = 1 iv_kind = `punct` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 12 iv_len = 12 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 28 iv_len = 5 iv_kind = `name` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 35 iv_len = 3 iv_kind = `name` ).
  ENDMETHOD.

  METHOD the_list_is_a_word_list.
*   What was given up for being the same on every host: a word in the list
*   is a keyword wherever it stands. The grammar knew that this VALUE is a
*   method's name; a word list does not, and this pins that it does not
*   pretend to.
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.

    lt_token = zcl_osd_abap_tokens=>scan( `METHOD value.` ).
    assert_token( it_token = lt_token iv_line = 1 iv_col = 8 iv_len = 5 iv_kind = `keyword` ).
    cl_abap_unit_assert=>assert_true( zcl_osd_abap_tokens=>is_keyword( `endmethod` ) ).
    cl_abap_unit_assert=>assert_false( zcl_osd_abap_tokens=>is_keyword( `zcl_osd_st05` ) ).
  ENDMETHOD.

  METHOD tokens_never_overlap.
*   the screen writes the text between two tokens as it is, so tokens in
*   order and apart are what keeps the displayed text the text
    DATA lt_token TYPE zcl_osd_abap_tokens=>tt_token.
    DATA ls_token TYPE zosd_token_s.
    DATA lv_line  TYPE i.
    DATA lv_after TYPE i.
    DATA lv_source TYPE string.

    lv_source = `CLASS lcl DEFINITION. "x` && cl_abap_char_utilities=>newline &&
                `  METHODS m IMPORTING iv TYPE string DEFAULT 'a''b' ##NEEDED.` && cl_abap_char_utilities=>newline &&
                `  x = |{ a }{ |in{ b }| }|. <fs>-c = zcl=>d( e->f[ 1 ] ).`.
    lt_token = zcl_osd_abap_tokens=>scan( lv_source ).
    cl_abap_unit_assert=>assert_not_initial( lt_token ).
    LOOP AT lt_token INTO ls_token.
      IF ls_token-line <> lv_line.
        lv_line = ls_token-line.
        lv_after = 1.
      ENDIF.
      cl_abap_unit_assert=>assert_true( act = boolc( ls_token-col >= lv_after )
                                        msg = |overlap at { ls_token-line }:{ ls_token-col }| ).
      cl_abap_unit_assert=>assert_true( act = boolc( ls_token-len > 0 )
                                        msg = |empty token at { ls_token-line }:{ ls_token-col }| ).
      lv_after = ls_token-col + ls_token-len.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
