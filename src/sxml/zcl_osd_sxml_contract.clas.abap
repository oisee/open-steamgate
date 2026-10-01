"! The sXML reader contract: one set of fixtures, any reader factory, the
"! input cut at every byte offset. The same source runs on the transpiler,
"! on gogen and on a system.
"!
"! Per fixture the reader is run over
"!   whole      the bytes as one chunk (ZCL_OSD_BYTES_WHOLE)
"!   2@k        two chunks cut at k, for every k in 1 .. n-1
"!   3@a,b      three chunks, C_THREE_SAMPLES cut pairs from a seeded
"!              generator (deterministic, the same on every host)
"!   bytes      n chunks of one byte each
"! and every run must give the fixture's expected event sequence. RUN
"! returns one mismatch per run that differs: the first differing event.
"!
"! Events: the reader is read with NEXT_NODE and NEXT_ATTRIBUTE only (the
"! token API), one line per event:
"!   OPEN "name" "nsuri"               an element opens
"!   ATTR "name" "nsuri" "value"       each attribute of that element, in
"!                                     the order NEXT_ATTRIBUTE gives them,
"!                                     directly after its OPEN
"!   VALUE "text"                      a text value
"!   CLOSE "name"                      an element closes
"!   NODE n                            any other node type NEXT_NODE reports
"!   FINAL                             the end of the document
"!   ERROR CLASS offset                an exception ends the sequence; the
"!                                     offset is XML_OFFSET of a
"!                                     CX_SXML_PARSE_ERROR (a byte offset on
"!                                     a system), "-" for any other class
"!   ABORT                             more than C_MAX_EVENTS (256) events;
"!                                     no fixture comes near it, a reader
"!                                     that never reports FINAL does
"! Names are local names; prefixes are not printed, namespace URIs are.
"! Inside the quotes every UTF-16 code unit from 0x20 to 0x7E except
"! the double quote, the backslash and the bar stands for itself; every other
"! one is written \uXXXX (four upper-case hex digits). So U+1F600 is
"! \uD83D\uDE00, a replacement character is \uFFFD and a lone surrogate
"! such as D800 is \uD800, none of which a plain string compare would show.
"! RECORD joins a fixture's events with "|", which therefore never occurs
"! unescaped inside an event.
CLASS zcl_osd_sxml_contract DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_fixture,
             name     TYPE string,
             group    TYPE string,
             status   TYPE string,
             fork     TYPE string,
             input    TYPE xstring,
             expected TYPE string_table,
           END OF ty_fixture.
    TYPES ty_fixtures TYPE STANDARD TABLE OF ty_fixture WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_mismatch,
             fixture  TYPE string,
             split    TYPE string,
             index    TYPE i,
             expected TYPE string,
             got      TYPE string,
           END OF ty_mismatch.
    TYPES ty_mismatches TYPE STANDARD TABLE OF ty_mismatch WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_split,
             name TYPE string,
             cuts TYPE zcl_osd_bytes_split=>ty_cuts,
           END OF ty_split.
    TYPES ty_splits TYPE STANDARD TABLE OF ty_split WITH DEFAULT KEY.

    CONSTANTS c_three_samples TYPE i VALUE 24.
    CONSTANTS c_seed TYPE i VALUE 4242.
    CONSTANTS c_max_events TYPE i VALUE 256.

    METHODS constructor
      IMPORTING ii_factory TYPE REF TO zif_osd_sxml_factory.
    "! every fixture over every split; one row per run that differs
    METHODS run
      IMPORTING it_fixtures         TYPE ty_fixtures
      RETURNING VALUE(rt_mismatches) TYPE ty_mismatches.
    "! the event sequence of one fixture over one split
    METHODS events_of
      IMPORTING iv_input         TYPE xstring
                is_split         TYPE ty_split
      RETURNING VALUE(rt_events) TYPE string_table.
    "! "@name|event|event|@name|..." over the whole input of each fixture:
    "! the format of the A4H recorder (test/fixtures/sxml-contract)
    METHODS record
      IMPORTING it_fixtures  TYPE ty_fixtures
      RETURNING VALUE(rv)    TYPE string.
    "! the normalisation: read a reader to its end or its exception
    CLASS-METHODS events
      IMPORTING ii_reader        TYPE REF TO if_sxml_reader
      RETURNING VALUE(rt_events) TYPE string_table.
    CLASS-METHODS error_line
      IMPORTING ix_error     TYPE REF TO cx_root
      RETURNING VALUE(rv)    TYPE string.
    CLASS-METHODS escape
      IMPORTING iv_text  TYPE string
      RETURNING VALUE(rv) TYPE string.
    "! whole, every two-chunk cut, the sampled three-chunk cuts, one-byte chunks
    CLASS-METHODS splits
      IMPORTING iv_length       TYPE i
      RETURNING VALUE(rt_splits) TYPE ty_splits.
    CLASS-METHODS format
      IMPORTING it_mismatches TYPE ty_mismatches
                iv_max        TYPE i DEFAULT 10
      RETURNING VALUE(rv)     TYPE string.
  PRIVATE SECTION.
    CONSTANTS c_plain TYPE string
      VALUE ` !#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_``abcdefghijklmnopqrstuvwxyz{}~`.
    DATA mi_factory TYPE REF TO zif_osd_sxml_factory.
    CLASS-METHODS quote
      IMPORTING iv_text  TYPE string
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.


CLASS zcl_osd_sxml_contract IMPLEMENTATION.

  METHOD constructor.
    mi_factory = ii_factory.
  ENDMETHOD.

  METHOD run.
    DATA ls_fixture TYPE ty_fixture.
    DATA lt_splits TYPE ty_splits.
    DATA ls_split TYPE ty_split.
    DATA lt_got TYPE string_table.
    DATA ls_mismatch TYPE ty_mismatch.
    DATA lv_exp TYPE string.
    DATA lv_got TYPE string.
    DATA lv_max TYPE i.
    DATA lv_i TYPE i.

    LOOP AT it_fixtures INTO ls_fixture.
      lt_splits = splits( xstrlen( ls_fixture-input ) ).
      LOOP AT lt_splits INTO ls_split.
        lt_got = events_of( iv_input = ls_fixture-input
                            is_split = ls_split ).
        IF lt_got = ls_fixture-expected AND ls_fixture-expected IS NOT INITIAL.
          CONTINUE.
        ENDIF.
        lv_max = lines( lt_got ).
        IF lines( ls_fixture-expected ) > lv_max.
          lv_max = lines( ls_fixture-expected ).
        ENDIF.
        IF lv_max = 0.
          lv_max = 1.
        ENDIF.
        lv_i = 0.
        DO lv_max TIMES.
          lv_i = sy-index.
          CLEAR: lv_exp, lv_got.
          READ TABLE ls_fixture-expected INDEX lv_i INTO lv_exp.
          IF sy-subrc <> 0.
            lv_exp = `<none>`.
          ENDIF.
          READ TABLE lt_got INDEX lv_i INTO lv_got.
          IF sy-subrc <> 0.
            lv_got = `<none>`.
          ENDIF.
          IF lv_exp <> lv_got OR lv_exp = `<none>`.
            EXIT.
          ENDIF.
        ENDDO.
        CLEAR ls_mismatch.
        ls_mismatch-fixture = ls_fixture-name.
        ls_mismatch-split = ls_split-name.
        ls_mismatch-index = lv_i.
        ls_mismatch-expected = lv_exp.
        ls_mismatch-got = lv_got.
        APPEND ls_mismatch TO rt_mismatches.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD events_of.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA lx_error TYPE REF TO cx_root.
    IF is_split-name = `whole`.
      CREATE OBJECT lo_source TYPE zcl_osd_bytes_whole
        EXPORTING iv_bytes = iv_input.
    ELSE.
      CREATE OBJECT lo_source TYPE zcl_osd_bytes_split
        EXPORTING iv_bytes = iv_input
                  it_cuts  = is_split-cuts.
    ENDIF.
    TRY.
        li_reader = mi_factory->create( lo_source ).
      CATCH cx_root INTO lx_error.
        APPEND error_line( lx_error ) TO rt_events.
        RETURN.
    ENDTRY.
    rt_events = events( li_reader ).
  ENDMETHOD.

  METHOD record.
    DATA ls_fixture TYPE ty_fixture.
    DATA ls_whole TYPE ty_split.
    DATA lt_events TYPE string_table.
    DATA lv_event TYPE string.
    ls_whole-name = `whole`.
    LOOP AT it_fixtures INTO ls_fixture.
      IF sy-tabix > 1.
        rv = rv && `|`.
      ENDIF.
      rv = rv && `@` && ls_fixture-name.
      lt_events = events_of( iv_input = ls_fixture-input
                             is_split = ls_whole ).
      LOOP AT lt_events INTO lv_event.
        rv = rv && `|` && lv_event.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD events.
    DATA lx_error TYPE REF TO cx_root.
    DATA lv_line TYPE string.
    DATA lv_type TYPE string.
    TRY.
        DO.
          IF lines( rt_events ) >= c_max_events.
            APPEND `ABORT` TO rt_events.
            RETURN.
          ENDIF.
          ii_reader->next_node( ).
          CASE ii_reader->node_type.
            WHEN if_sxml_node=>co_nt_final.
              APPEND `FINAL` TO rt_events.
              RETURN.
            WHEN if_sxml_node=>co_nt_element_open.
              lv_line = `OPEN ` && quote( ii_reader->name ) && ` ` && quote( ii_reader->nsuri ).
              APPEND lv_line TO rt_events.
              DO.
                IF lines( rt_events ) >= c_max_events.
                  EXIT.
                ENDIF.
                ii_reader->next_attribute( ).
                IF ii_reader->node_type <> if_sxml_node=>co_nt_attribute.
                  EXIT.
                ENDIF.
                lv_line = `ATTR ` && quote( ii_reader->name ) && ` ` && quote( ii_reader->nsuri )
                  && ` ` && quote( ii_reader->value ).
                APPEND lv_line TO rt_events.
              ENDDO.
            WHEN if_sxml_node=>co_nt_element_close.
              lv_line = `CLOSE ` && quote( ii_reader->name ).
              APPEND lv_line TO rt_events.
            WHEN if_sxml_node=>co_nt_value.
              lv_line = `VALUE ` && quote( ii_reader->value ).
              APPEND lv_line TO rt_events.
            WHEN OTHERS.
              lv_type = ii_reader->node_type.
              CONDENSE lv_type.
              lv_line = `NODE ` && lv_type.
              APPEND lv_line TO rt_events.
          ENDCASE.
        ENDDO.
      CATCH cx_root INTO lx_error.
        APPEND error_line( lx_error ) TO rt_events.
    ENDTRY.
  ENDMETHOD.

  METHOD error_line.
    DATA lx_parse TYPE REF TO cx_sxml_parse_error.
    DATA lv_class TYPE string.
    DATA lv_offset TYPE string.
    lv_class = cl_abap_classdescr=>get_class_name( ix_error ).
    FIND REGEX `=([^=]*)$` IN lv_class SUBMATCHES lv_class.
    lv_offset = `-`.
    TRY.
        lx_parse ?= ix_error.
        lv_offset = lx_parse->xml_offset.
        CONDENSE lv_offset.
      CATCH cx_sy_move_cast_error.
        lv_offset = `-`.
    ENDTRY.
    rv = `ERROR ` && lv_class && ` ` && lv_offset.
  ENDMETHOD.

  METHOD quote.
    rv = `"` && escape( iv_text ) && `"`.
  ENDMETHOD.

  METHOD escape.
    DATA lv_len TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_c TYPE c LENGTH 1.
    DATA lv_code TYPE x LENGTH 2.
    DATA lv_hex TYPE string.
    IF iv_text CO c_plain.
      rv = iv_text.
      RETURN.
    ENDIF.
    lv_len = strlen( iv_text ).
    WHILE lv_pos < lv_len.
      lv_c = iv_text+lv_pos(1).
      IF iv_text+lv_pos(1) = ` `.
        rv = rv && ` `.
      ELSEIF lv_c CA c_plain.
        rv = rv && lv_c.
      ELSE.
        TRY.
            lv_code = cl_abap_conv_out_ce=>uccp( lv_c ).
            lv_hex = lv_code.
          CATCH cx_root.
            lv_hex = `????`.
        ENDTRY.
        rv = rv && `\u` && lv_hex.
      ENDIF.
      lv_pos = lv_pos + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD splits.
    DATA ls_split TYPE ty_split.
    DATA lv_k TYPE i.
    DATA lv_a TYPE i.
    DATA lv_b TYPE i.
    DATA lv_t TYPE i.
    DATA lv_x TYPE i.
    DATA lv_s TYPE string.

    ls_split-name = `whole`.
    APPEND ls_split TO rt_splits.
    IF iv_length < 2.
      RETURN.
    ENDIF.

    lv_k = 1.
    WHILE lv_k < iv_length.
      CLEAR ls_split.
      APPEND lv_k TO ls_split-cuts.
      lv_s = lv_k.
      CONDENSE lv_s.
      ls_split-name = `2@` && lv_s.
      APPEND ls_split TO rt_splits.
      lv_k = lv_k + 1.
    ENDWHILE.

* three chunks: a ZX81-style generator, x' = ( 75x + 74 ) mod 65537, which
* stays inside a four-byte integer on every host; same seed per fixture
    IF iv_length >= 3.
      lv_x = c_seed.
      DO c_three_samples TIMES.
        lv_x = ( lv_x * 75 + 74 ) MOD 65537.
        lv_a = 1 + lv_x MOD ( iv_length - 1 ).
        lv_x = ( lv_x * 75 + 74 ) MOD 65537.
        lv_b = 1 + lv_x MOD ( iv_length - 1 ).
        IF lv_a = lv_b.
          CONTINUE.
        ENDIF.
        IF lv_a > lv_b.
          lv_t = lv_a.
          lv_a = lv_b.
          lv_b = lv_t.
        ENDIF.
        CLEAR ls_split.
        APPEND lv_a TO ls_split-cuts.
        APPEND lv_b TO ls_split-cuts.
        lv_s = lv_a.
        CONDENSE lv_s.
        ls_split-name = `3@` && lv_s.
        lv_s = lv_b.
        CONDENSE lv_s.
        ls_split-name = ls_split-name && `,` && lv_s.
        APPEND ls_split TO rt_splits.
      ENDDO.
    ENDIF.

    CLEAR ls_split.
    ls_split-name = `bytes`.
    lv_k = 1.
    WHILE lv_k < iv_length.
      APPEND lv_k TO ls_split-cuts.
      lv_k = lv_k + 1.
    ENDWHILE.
    APPEND ls_split TO rt_splits.
  ENDMETHOD.

  METHOD format.
    DATA ls_mismatch TYPE ty_mismatch.
    DATA lv_index TYPE string.
    DATA lv_count TYPE string.
    lv_count = lines( it_mismatches ).
    CONDENSE lv_count.
    rv = lv_count && ` mismatches`.
    LOOP AT it_mismatches INTO ls_mismatch.
      IF sy-tabix > iv_max.
        rv = rv && `; ...`.
        EXIT.
      ENDIF.
      lv_index = ls_mismatch-index.
      CONDENSE lv_index.
      rv = rv && `; ` && ls_mismatch-fixture && ` ` && ls_mismatch-split && ` #` && lv_index
        && ` expected ` && ls_mismatch-expected && ` got ` && ls_mismatch-got.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
