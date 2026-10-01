* Broken factories. Each is a mistake a streaming reader can make, and the
* contract has to catch every one of them by its splits alone: on the whole
* input each of them is right.

* 1. a chunk boundary byte is lost: the first byte of every chunk after the
*    first is dropped
CLASS lcl_drop_boundary_byte DEFINITION FINAL.
  PUBLIC SECTION.
    INTERFACES zif_osd_sxml_factory.
ENDCLASS.

CLASS lcl_drop_boundary_byte IMPLEMENTATION.
  METHOD zif_osd_sxml_factory~create.
    DATA lv_all TYPE xstring.
    DATA lv_chunk TYPE xstring.
    DATA lv_n TYPE i.
    DO.
      lv_chunk = io_source->next( ).
      IF xstrlen( lv_chunk ) = 0.
        EXIT.
      ENDIF.
      lv_n = lv_n + 1.
      IF lv_n > 1.
        lv_chunk = lv_chunk+1.
      ENDIF.
      CONCATENATE lv_all lv_chunk INTO lv_all IN BYTE MODE.
    ENDDO.
    ri = cl_sxml_string_reader=>create( lv_all ).
  ENDMETHOD.
ENDCLASS.

* 2. every chunk is decoded on its own, so a UTF-8 sequence cut by a
*    boundary becomes two replacement characters
CLASS lcl_decode_per_chunk DEFINITION FINAL.
  PUBLIC SECTION.
    INTERFACES zif_osd_sxml_factory.
ENDCLASS.

CLASS lcl_decode_per_chunk IMPLEMENTATION.
  METHOD zif_osd_sxml_factory~create.
    DATA lv_chunk TYPE xstring.
    DATA lv_part TYPE string.
    DATA lv_text TYPE string.
    DATA lo_conv TYPE REF TO cl_abap_conv_in_ce.
    DO.
      lv_chunk = io_source->next( ).
      IF xstrlen( lv_chunk ) = 0.
        EXIT.
      ENDIF.
      lo_conv = cl_abap_conv_in_ce=>create( encoding    = 'UTF-8'
                                            ignore_cerr = abap_true ).
      lo_conv->convert( EXPORTING input = lv_chunk
                        IMPORTING data  = lv_part ).
      lv_text = lv_text && lv_part.
    ENDDO.
    ri = cl_sxml_string_reader=>create( cl_abap_codepage=>convert_to( lv_text ) ).
  ENDMETHOD.
ENDCLASS.

* 3. the error offset is counted from the start of the chunk the error was
*    found in, not from the start of the document
CLASS lcl_offset_reader DEFINITION FINAL.
  PUBLIC SECTION.
    TYPES ty_starts TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    INTERFACES if_sxml_reader.
    METHODS constructor
      IMPORTING ii_inner  TYPE REF TO if_sxml_reader
                it_starts TYPE ty_starts.
  PRIVATE SECTION.
    DATA mi_inner TYPE REF TO if_sxml_reader.
    DATA mt_starts TYPE ty_starts.
    METHODS copy.
    METHODS relative
      IMPORTING iv_offset TYPE i
      RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS lcl_offset_reader IMPLEMENTATION.
  METHOD constructor.
    mi_inner = ii_inner.
    mt_starts = it_starts.
  ENDMETHOD.

  METHOD copy.
    if_sxml_reader~node_type = mi_inner->node_type.
    if_sxml_reader~name = mi_inner->name.
    if_sxml_reader~prefix = mi_inner->prefix.
    if_sxml_reader~nsuri = mi_inner->nsuri.
    if_sxml_reader~value_type = mi_inner->value_type.
    if_sxml_reader~value = mi_inner->value.
    if_sxml_reader~value_raw = mi_inner->value_raw.
  ENDMETHOD.

  METHOD relative.
    DATA lv_start TYPE i.
    DATA lv_best TYPE i.
    LOOP AT mt_starts INTO lv_start.
      IF lv_start <= iv_offset.
        lv_best = lv_start.
      ENDIF.
    ENDLOOP.
    rv = iv_offset - lv_best.
  ENDMETHOD.

  METHOD if_sxml_reader~next_node.
    DATA lx_parse TYPE REF TO cx_sxml_parse_error.
    TRY.
        mi_inner->next_node( value_type ).
      CATCH cx_sxml_parse_error INTO lx_parse.
        RAISE EXCEPTION TYPE cx_sxml_parse_error
          EXPORTING xml_offset = relative( lx_parse->xml_offset ).
    ENDTRY.
    copy( ).
  ENDMETHOD.

  METHOD if_sxml_reader~next_attribute.
    mi_inner->next_attribute( value_type ).
    copy( ).
  ENDMETHOD.

  METHOD if_sxml_reader~read_next_node.
    node = mi_inner->read_next_node( ).
    copy( ).
  ENDMETHOD.

  METHOD if_sxml_reader~skip_node.
    mi_inner->skip_node( writer ).
    copy( ).
  ENDMETHOD.

  METHOD if_sxml_reader~set_option.
    mi_inner->set_option( option = option
                          value  = value ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_nsuri_by_prefix.
    nsuri = mi_inner->get_nsuri_by_prefix( prefix ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_prefix_by_nsuri.
    prefix = mi_inner->get_prefix_by_nsuri( nsuri ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_nsbindings.
    nsbindings = mi_inner->get_nsbindings( ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_path.
    path = mi_inner->get_path( ).
  ENDMETHOD.

  METHOD if_sxml_reader~current_node.
    mi_inner->current_node( ).
  ENDMETHOD.

  METHOD if_sxml_reader~read_current_node.
    node = mi_inner->read_current_node( ).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_offset_in_chunk DEFINITION FINAL.
  PUBLIC SECTION.
    INTERFACES zif_osd_sxml_factory.
ENDCLASS.

CLASS lcl_offset_in_chunk IMPLEMENTATION.
  METHOD zif_osd_sxml_factory~create.
    DATA lv_all TYPE xstring.
    DATA lv_chunk TYPE xstring.
    DATA lt_starts TYPE lcl_offset_reader=>ty_starts.
    DATA lv_start TYPE i.
    DO.
      lv_chunk = io_source->next( ).
      IF xstrlen( lv_chunk ) = 0.
        EXIT.
      ENDIF.
      lv_start = xstrlen( lv_all ).
      APPEND lv_start TO lt_starts.
      CONCATENATE lv_all lv_chunk INTO lv_all IN BYTE MODE.
    ENDDO.
    CREATE OBJECT ri TYPE lcl_offset_reader
      EXPORTING ii_inner  = cl_sxml_string_reader=>create( lv_all )
                it_starts = lt_starts.
  ENDMETHOD.
ENDCLASS.


CLASS ltcl_sources DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS whole_once_then_eof FOR TESTING RAISING cx_static_check.
    METHODS split_at_cuts FOR TESTING RAISING cx_static_check.
    METHODS split_ignores_bad_cuts FOR TESTING RAISING cx_static_check.
    METHODS splits_cover_every_offset FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_sources IMPLEMENTATION.

  METHOD whole_once_then_eof.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    CREATE OBJECT lo_source TYPE zcl_osd_bytes_whole
      EXPORTING iv_bytes = 'C3A961'.
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = 'C3A961' ).
    cl_abap_unit_assert=>assert_initial( lo_source->next( ) ).
    cl_abap_unit_assert=>assert_initial( lo_source->next( ) ).
  ENDMETHOD.

  METHOD split_at_cuts.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    DATA lt_cuts TYPE zcl_osd_bytes_split=>ty_cuts.
    APPEND 3 TO lt_cuts.
    APPEND 1 TO lt_cuts.
    CREATE OBJECT lo_source TYPE zcl_osd_bytes_split
      EXPORTING iv_bytes = '3CC3A93E'
                it_cuts  = lt_cuts.
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = '3C' ).
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = 'C3A9' ).
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = '3E' ).
    cl_abap_unit_assert=>assert_initial( lo_source->next( ) ).
    cl_abap_unit_assert=>assert_initial( lo_source->next( ) ).
  ENDMETHOD.

  METHOD split_ignores_bad_cuts.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    DATA lt_cuts TYPE zcl_osd_bytes_split=>ty_cuts.
    APPEND 0 TO lt_cuts.
    APPEND 2 TO lt_cuts.
    APPEND 2 TO lt_cuts.
    APPEND 9 TO lt_cuts.
    CREATE OBJECT lo_source TYPE zcl_osd_bytes_split
      EXPORTING iv_bytes = '010203'
                it_cuts  = lt_cuts.
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = '0102' ).
    cl_abap_unit_assert=>assert_equals( act = lo_source->next( )
                                        exp = '03' ).
    cl_abap_unit_assert=>assert_initial( lo_source->next( ) ).
  ENDMETHOD.

  METHOD splits_cover_every_offset.
    DATA lt_splits TYPE zcl_osd_sxml_contract=>ty_splits.
    DATA ls_split TYPE zcl_osd_sxml_contract=>ty_split.
    DATA lv_two TYPE i.
    DATA lv_three TYPE i.
    lt_splits = zcl_osd_sxml_contract=>splits( 10 ).
    LOOP AT lt_splits INTO ls_split.
      IF ls_split-name CP '2@*'.
        lv_two = lv_two + 1.
      ELSEIF ls_split-name CP '3@*'.
        lv_three = lv_three + 1.
        cl_abap_unit_assert=>assert_equals( act = lines( ls_split-cuts )
                                            exp = 2 ).
      ENDIF.
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = lv_two
                                        exp = 9 ).
    cl_abap_unit_assert=>assert_number_between( number = lv_three
                                                lower  = 1
                                                upper  = zcl_osd_sxml_contract=>c_three_samples ).
    READ TABLE lt_splits INDEX 1 INTO ls_split.
    cl_abap_unit_assert=>assert_equals( act = ls_split-name
                                        exp = `whole` ).
    READ TABLE lt_splits INDEX lines( lt_splits ) INTO ls_split.
    cl_abap_unit_assert=>assert_equals( act = ls_split-name
                                        exp = `bytes` ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_split-cuts )
                                        exp = 9 ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_sxml_contract=>splits( 10 )
                                        exp = lt_splits ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_normalise DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS escape_code_units FOR TESTING RAISING cx_static_check.
    METHODS events_of_a_document FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_normalise IMPLEMENTATION.

  METHOD escape_code_units.
    DATA lv_tab TYPE string.
    lv_tab = cl_abap_char_utilities=>horizontal_tab.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_sxml_contract=>escape( cl_abap_codepage=>convert_from( '6120C3A9E282ACF09F988022675C7C60' ) )
      exp = 'a \u00E9\u20AC\uD83D\uDE00\u0022g\u005C\u007C`' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_sxml_contract=>escape( lv_tab )
      exp = '\u0009' ).
    cl_abap_unit_assert=>assert_initial( zcl_osd_sxml_contract=>escape( `` ) ).
  ENDMETHOD.

  METHOD events_of_a_document.
    DATA lt_exp TYPE string_table.
    APPEND `OPEN "r" "urn:d"` TO lt_exp.
    APPEND `ATTR "x" "" "1 2"` TO lt_exp.
    APPEND `VALUE "\u00E9"` TO lt_exp.
    APPEND `CLOSE "r"` TO lt_exp.
    APPEND `FINAL` TO lt_exp.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_sxml_contract=>events(
              cl_sxml_string_reader=>create( cl_abap_codepage=>convert_to( `<r xmlns="urn:d" x="1 2">` && cl_abap_conv_in_ce=>uccpi( 233 ) && `</r>` ) ) )
      exp = lt_exp ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_contract DEFINITION FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
* FORK of a fixture says what the pinned open-abap-core fork does with it
* (tools/osd-sxml-contract.mjs provisional sets it from a run): MISS, it
* gives another sequence than the expected one; DUMPS, it ends the run with
* a runtime error no CATCH sees, so the fixture is left out of every run
* here. A MISS against an A4H measurement is an ANORMALIES entry, not a test
* edit; when the fork is fixed the reference test goes red here first.
    DATA mv_misses TYPE string.
    DATA mt_fixtures TYPE zcl_osd_sxml_contract=>ty_fixtures.
    METHODS setup.
    METHODS run
      IMPORTING ii_factory          TYPE REF TO zif_osd_sxml_factory
      RETURNING VALUE(rt_mismatches) TYPE zcl_osd_sxml_contract=>ty_mismatches.
    "! the mismatches outside the fixtures the fork is known to miss
    METHODS beyond_known
      IMPORTING it_mismatches       TYPE zcl_osd_sxml_contract=>ty_mismatches
      RETURNING VALUE(rt_mismatches) TYPE zcl_osd_sxml_contract=>ty_mismatches.
    METHODS fixtures_are_sound FOR TESTING RAISING cx_static_check.
    METHODS reference_concat FOR TESTING RAISING cx_static_check.
    METHODS mutant_drop_boundary_byte FOR TESTING RAISING cx_static_check.
    METHODS mutant_decode_per_chunk FOR TESTING RAISING cx_static_check.
    METHODS mutant_offset_in_chunk FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_contract IMPLEMENTATION.

  METHOD setup.
    DATA ls_fixture TYPE zcl_osd_sxml_contract=>ty_fixture.
    mt_fixtures = zcl_osd_sxml_fixtures=>all( ).
    DELETE mt_fixtures WHERE fork = `DUMPS`.
    mv_misses = ` `.
    LOOP AT mt_fixtures INTO ls_fixture WHERE fork = `MISS`.
      mv_misses = mv_misses && ls_fixture-name && ` `.
    ENDLOOP.
  ENDMETHOD.

  METHOD run.
    DATA lo_contract TYPE REF TO zcl_osd_sxml_contract.
    CREATE OBJECT lo_contract EXPORTING ii_factory = ii_factory.
    rt_mismatches = lo_contract->run( mt_fixtures ).
  ENDMETHOD.

  METHOD beyond_known.
    DATA ls_mismatch TYPE zcl_osd_sxml_contract=>ty_mismatch.
    DATA lv_key TYPE string.
    LOOP AT it_mismatches INTO ls_mismatch.
      lv_key = ` ` && ls_mismatch-fixture && ` `.
      IF mv_misses NS lv_key.
        APPEND ls_mismatch TO rt_mismatches.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD fixtures_are_sound.
    DATA ls_fixture TYPE zcl_osd_sxml_contract=>ty_fixture.
    DATA lv_line TYPE string.
    cl_abap_unit_assert=>assert_number_between( number = lines( zcl_osd_sxml_fixtures=>all( ) )
                                                lower  = 50
                                                upper  = 1000 ).
    LOOP AT mt_fixtures INTO ls_fixture.
      cl_abap_unit_assert=>assert_not_initial( act = ls_fixture-expected
                                               msg = ls_fixture-name ).
      READ TABLE ls_fixture-expected INDEX lines( ls_fixture-expected ) INTO lv_line.
      IF lv_line <> `FINAL` AND lv_line NP 'ERROR *' AND lv_line <> `ABORT`.
        cl_abap_unit_assert=>fail( msg = ls_fixture-name && ` does not end in FINAL or ERROR` ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD reference_concat.
* The reference passes every split of every fixture it reads the way A4H
* does, and on the ones it does not it gives the same wrong answer for
* every split: the split half of the contract holds by construction.
    DATA li_factory TYPE REF TO zif_osd_sxml_factory.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    DATA ls_mismatch TYPE zcl_osd_sxml_contract=>ty_mismatch.
    DATA ls_whole TYPE zcl_osd_sxml_contract=>ty_mismatch.
    DATA lv_missed TYPE string.
    CREATE OBJECT li_factory TYPE zcl_osd_sxml_factory_concat.
    lt_mismatches = run( li_factory ).
    cl_abap_unit_assert=>assert_initial(
      act = beyond_known( lt_mismatches )
      msg = zcl_osd_sxml_contract=>format( beyond_known( lt_mismatches ) ) ).
    lv_missed = ` `.
    LOOP AT lt_mismatches INTO ls_mismatch.
      IF ls_mismatch-split = `whole`.
        ls_whole = ls_mismatch.
        lv_missed = lv_missed && ls_mismatch-fixture && ` `.
        CONTINUE.
      ENDIF.
      cl_abap_unit_assert=>assert_equals( act = ls_mismatch-fixture
                                          exp = ls_whole-fixture
                                          msg = `a split mismatches where the whole input did not` ).
      cl_abap_unit_assert=>assert_equals( act = ls_mismatch-got
                                          exp = ls_whole-got
                                          msg = ls_mismatch-fixture && ` ` && ls_mismatch-split ).
      cl_abap_unit_assert=>assert_equals( act = ls_mismatch-index
                                          exp = ls_whole-index
                                          msg = ls_mismatch-fixture && ` ` && ls_mismatch-split ).
    ENDLOOP.
* every known miss is still a miss: a fixed fork shows here first
    cl_abap_unit_assert=>assert_equals( act = lv_missed
                                        exp = mv_misses ).
  ENDMETHOD.

  METHOD mutant_drop_boundary_byte.
    DATA li_factory TYPE REF TO zif_osd_sxml_factory.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    CREATE OBJECT li_factory TYPE lcl_drop_boundary_byte.
* The pinned fork reads a declaration with a byte cut out of it by dumping
* (CONVT_NO_NUMBER, no CATCH sees it) instead of raising a parse error, so a
* corrupted declaration would end the whole run: it is left out of this
* mutant only. ANORMALIES, sXML reader entry.
    DELETE mt_fixtures WHERE name = `xml_decl_lowercase_utf8`.
    lt_mismatches = beyond_known( run( li_factory ) ).
    cl_abap_unit_assert=>assert_not_initial( lt_mismatches ).
    READ TABLE lt_mismatches WITH KEY split = `whole` TRANSPORTING NO FIELDS.
    cl_abap_unit_assert=>assert_subrc( exp = 4
                                       msg = `the whole input has no boundary to lose` ).
  ENDMETHOD.

  METHOD mutant_decode_per_chunk.
* On the whole input this mutant replaces where the fork raises, so two
* fixtures of invalid UTF-8 differ even unsplit; what counts is a fixture
* the whole input passes and a cut sequence breaks.
    DATA li_factory TYPE REF TO zif_osd_sxml_factory.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    DATA ls_mismatch TYPE zcl_osd_sxml_contract=>ty_mismatch.
    DATA lv_whole TYPE string.
    DATA lv_key TYPE string.
    DATA lv_replaced TYPE abap_bool.
    CREATE OBJECT li_factory TYPE lcl_decode_per_chunk.
    lt_mismatches = beyond_known( run( li_factory ) ).
    lv_whole = ` `.
    LOOP AT lt_mismatches INTO ls_mismatch WHERE split = `whole`.
      lv_whole = lv_whole && ls_mismatch-fixture && ` `.
    ENDLOOP.
    LOOP AT lt_mismatches INTO ls_mismatch.
      lv_key = ` ` && ls_mismatch-fixture && ` `.
      IF lv_whole NS lv_key AND ls_mismatch-got CS '\uFFFD'.
        lv_replaced = abap_true.
      ENDIF.
    ENDLOOP.
    cl_abap_unit_assert=>assert_true( act = lv_replaced
                                      msg = `a cut sequence shows as replacement characters` ).
  ENDMETHOD.

  METHOD mutant_offset_in_chunk.
    DATA li_factory TYPE REF TO zif_osd_sxml_factory.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    DATA ls_mismatch TYPE zcl_osd_sxml_contract=>ty_mismatch.
    CREATE OBJECT li_factory TYPE lcl_offset_in_chunk.
    lt_mismatches = beyond_known( run( li_factory ) ).
    cl_abap_unit_assert=>assert_not_initial( lt_mismatches ).
    LOOP AT lt_mismatches INTO ls_mismatch.
* (not assert_differs: open-abap-core's never fails, see ANORMALIES)
      IF ls_mismatch-split = `whole`.
        cl_abap_unit_assert=>fail( msg = `the whole input has no chunk to count from` ).
      ENDIF.
      cl_abap_unit_assert=>assert_char_cp( act = ls_mismatch-expected
                                           exp = 'ERROR *' ).
      cl_abap_unit_assert=>assert_char_cp( act = ls_mismatch-got
                                           exp = 'ERROR *' ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.


* A reader under test: add one method here, e.g. for a streaming factory
* ZCL_X_SXML_FACTORY (any class implementing ZIF_OSD_SXML_FACTORY):
*
*     METHODS streaming FOR TESTING RAISING cx_static_check.
*     METHOD streaming.
*       assert_contract( NEW zcl_x_sxml_factory( ) ).   " or CREATE OBJECT
*     ENDMETHOD.
*
* ASSERT_CONTRACT fails with the first ten mismatches (fixture, split, event
* index, expected, got). The fixtures with status provisional-fork hold the
* fork's behaviour until the A4H recording replaces them.
CLASS ltcl_readers DEFINITION FOR TESTING DURATION MEDIUM RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS assert_contract
      IMPORTING ii_factory TYPE REF TO zif_osd_sxml_factory.
    METHODS harness_fails_a_bad_reader FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_readers IMPLEMENTATION.

  METHOD assert_contract.
    DATA lo_contract TYPE REF TO zcl_osd_sxml_contract.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    CREATE OBJECT lo_contract EXPORTING ii_factory = ii_factory.
    lt_mismatches = lo_contract->run( zcl_osd_sxml_fixtures=>all( ) ).
    cl_abap_unit_assert=>assert_initial( act = lt_mismatches
                                         msg = zcl_osd_sxml_contract=>format( lt_mismatches ) ).
  ENDMETHOD.

  METHOD harness_fails_a_bad_reader.
* the harness itself, on one fixture and one mutant: it must report
    DATA lo_contract TYPE REF TO zcl_osd_sxml_contract.
    DATA li_factory TYPE REF TO zif_osd_sxml_factory.
    DATA lt_fixtures TYPE zcl_osd_sxml_contract=>ty_fixtures.
    DATA ls_fixture TYPE zcl_osd_sxml_contract=>ty_fixture.
    DATA lt_mismatches TYPE zcl_osd_sxml_contract=>ty_mismatches.
    DATA ls_mismatch TYPE zcl_osd_sxml_contract=>ty_mismatch.
    lt_fixtures = zcl_osd_sxml_fixtures=>all( ).
    READ TABLE lt_fixtures WITH KEY name = `xml_simple` INTO ls_fixture.
    cl_abap_unit_assert=>assert_subrc( ).
    CLEAR lt_fixtures.
    APPEND ls_fixture TO lt_fixtures.
    CREATE OBJECT li_factory TYPE lcl_drop_boundary_byte.
    CREATE OBJECT lo_contract EXPORTING ii_factory = li_factory.
    lt_mismatches = lo_contract->run( lt_fixtures ).
* <a>t</a> has 8 bytes: 7 two-chunk splits, the sampled three-chunk ones
* and the one-byte chunks all lose a byte
    cl_abap_unit_assert=>assert_number_between( number = lines( lt_mismatches )
                                                lower  = 8
                                                upper  = 8 + zcl_osd_sxml_contract=>c_three_samples ).
    READ TABLE lt_mismatches INDEX 1 INTO ls_mismatch.
    cl_abap_unit_assert=>assert_equals( act = ls_mismatch-fixture
                                        exp = `xml_simple` ).
    cl_abap_unit_assert=>assert_equals( act = ls_mismatch-split
                                        exp = `2@1` ).
  ENDMETHOD.

ENDCLASS.
