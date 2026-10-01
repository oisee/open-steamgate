CLASS ltcl_stream DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS reader
      IMPORTING iv_bytes         TYPE xstring
                iv_chunk         TYPE i DEFAULT 0
      RETURNING VALUE(ro_reader) TYPE REF TO zcl_osd_sxml_stream_reader.
    METHODS node_api FOR TESTING RAISING cx_static_check.
    METHODS utf16_bom FOR TESTING RAISING cx_static_check.
    METHODS latin1_declared FOR TESTING RAISING cx_static_check.
    METHODS path_and_bindings FOR TESTING RAISING cx_static_check.
    METHODS window_is_bounded FOR TESTING RAISING cx_static_check.
    METHODS raw_value FOR TESTING RAISING cx_static_check.
    METHODS skip_with_writer FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_stream IMPLEMENTATION.

  METHOD reader.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    DATA lt_cuts TYPE zcl_osd_bytes_split=>ty_cuts.
    DATA lv_cut TYPE i.
    IF iv_chunk > 0.
      lv_cut = iv_chunk.
      WHILE lv_cut < xstrlen( iv_bytes ).
        APPEND lv_cut TO lt_cuts.
        lv_cut = lv_cut + iv_chunk.
      ENDWHILE.
    ENDIF.
    CREATE OBJECT lo_source TYPE zcl_osd_bytes_split
      EXPORTING iv_bytes = iv_bytes
                it_cuts  = lt_cuts.
    CREATE OBJECT ro_reader EXPORTING io_source = lo_source.
  ENDMETHOD.

  METHOD node_api.
* the loop of a converter: read_next_node, cast, qname, attributes, values
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA li_node TYPE REF TO if_sxml_node.
    DATA li_open TYPE REF TO if_sxml_open_element.
    DATA li_close TYPE REF TO if_sxml_close_element.
    DATA li_value TYPE REF TO if_sxml_value_node.
    DATA lt_attributes TYPE if_sxml_attribute=>attributes.
    DATA li_attribute TYPE REF TO if_sxml_attribute.
    DATA lv_trace TYPE string.
    li_reader = reader( iv_bytes = cl_abap_codepage=>convert_to( `<r><p k="1" n="a&amp;b">x</p><q/></r>` )
                        iv_chunk = 3 ).
    DO.
      li_node = li_reader->read_next_node( ).
      IF li_node IS INITIAL.
        EXIT.
      ENDIF.
      CASE li_node->type.
        WHEN if_sxml_node=>co_nt_element_open.
          li_open ?= li_node.
          lv_trace = lv_trace && `<` && li_open->qname-name.
          lt_attributes = li_open->get_attributes( ).
          LOOP AT lt_attributes INTO li_attribute.
            lv_trace = lv_trace && ` ` && li_attribute->qname-name && `=` && li_attribute->get_value( ).
          ENDLOOP.
          lv_trace = lv_trace && `>`.
        WHEN if_sxml_node=>co_nt_element_close.
          li_close ?= li_node.
          lv_trace = lv_trace && `</` && li_close->qname-name && `>`.
        WHEN if_sxml_node=>co_nt_value.
          li_value ?= li_node.
          lv_trace = lv_trace && li_value->get_value( ).
      ENDCASE.
    ENDDO.
    cl_abap_unit_assert=>assert_equals( act = lv_trace
                                        exp = `<r><p k=1 n=a&b>x</p><q></q></r>` ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->node_type
                                        exp = if_sxml_node=>co_nt_final ).
  ENDMETHOD.

  METHOD utf16_bom.
    DATA li_reader TYPE REF TO if_sxml_reader.
* FF FE then <a>e acute</a> in UTF-16LE, cut inside a code unit
    li_reader = reader( iv_bytes = 'FFFE3C0061003E00E9003C002F0061003E00'
                        iv_chunk = 3 ).
    li_reader->next_node( ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->name
                                        exp = `a` ).
    li_reader->next_node( ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->value
                                        exp = cl_abap_codepage=>convert_from( 'C3A9' ) ).
  ENDMETHOD.

  METHOD latin1_declared.
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA lv_doc TYPE xstring.
    DATA lv_head TYPE xstring.
    DATA lv_tail TYPE xstring.
    DATA lv_byte TYPE x LENGTH 1 VALUE 'E4'.
    lv_head = cl_abap_codepage=>convert_to( `<?xml version="1.0" encoding="ISO-8859-1"?><a>` ).
    lv_tail = cl_abap_codepage=>convert_to( `</a>` ).
    CONCATENATE lv_head lv_byte lv_tail INTO lv_doc IN BYTE MODE.
    li_reader = reader( lv_doc ).
    li_reader->next_node( ).
    li_reader->next_node( ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->value
                                        exp = cl_abap_codepage=>convert_from( 'C3A4' ) ).
  ENDMETHOD.

  METHOD path_and_bindings.
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA lt_path TYPE if_sxml_named=>path.
    DATA ls_node TYPE if_sxml_named=>pathnode.
    li_reader = reader( cl_abap_codepage=>convert_to( `<r xmlns:p="urn:p"><a/><p:b/></r>` ) ).
    li_reader->next_node( ).
    li_reader->next_node( ).
    li_reader->next_node( ).
    li_reader->next_node( ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->name
                                        exp = `b` ).
    lt_path = li_reader->get_path( ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_path )
                                        exp = 2 ).
    READ TABLE lt_path INDEX 2 INTO ls_node.
    cl_abap_unit_assert=>assert_equals( act = ls_node-child_position
                                        exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = ls_node-qname-namespace
                                        exp = `urn:p` ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->get_nsuri_by_prefix( `p` )
                                        exp = `urn:p` ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->get_prefix_by_nsuri( `urn:p` )
                                        exp = `p` ).
  ENDMETHOD.

  METHOD window_is_bounded.
* 400 KB of records read in 4 KB chunks: the window never holds more than
* the compaction step, one record and one chunk
    DATA lv_record TYPE xstring.
    DATA lv_doc TYPE xstring.
    DATA lo_reader TYPE REF TO zcl_osd_sxml_stream_reader.
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA lv_values TYPE i.
    DATA lv_head TYPE xstring.
    DATA lv_tail TYPE xstring.
    DATA lv_chars TYPE xstring VALUE 'C3A9E282ACF09F9880'.
    lv_head = cl_abap_codepage=>convert_to( `<rec id="12345"><name>abcdefghijklmnopqrstuvwxyz</name><v>` ).
    lv_tail = cl_abap_codepage=>convert_to( `</v></rec>` ).
    CONCATENATE lv_head lv_chars lv_tail INTO lv_record IN BYTE MODE.
    lv_doc = cl_abap_codepage=>convert_to( `<doc>` ).
    DO 4500 TIMES.
      CONCATENATE lv_doc lv_record INTO lv_doc IN BYTE MODE.
    ENDDO.
    lv_tail = cl_abap_codepage=>convert_to( `</doc>` ).
    CONCATENATE lv_doc lv_tail INTO lv_doc IN BYTE MODE.
    lo_reader = reader( iv_bytes = lv_doc
                        iv_chunk = 4096 ).
    li_reader = lo_reader.
    DO.
      li_reader->next_node( ).
      IF li_reader->node_type = if_sxml_node=>co_nt_final.
        EXIT.
      ELSEIF li_reader->node_type = if_sxml_node=>co_nt_value.
        lv_values = lv_values + 1.
      ENDIF.
    ENDDO.
    cl_abap_unit_assert=>assert_equals( act = lv_values
                                        exp = 9000 ).
    cl_abap_unit_assert=>assert_number_between( number = lo_reader->pull->peak_window
                                                lower  = 4096
                                                upper  = zcl_osd_sxml_pull=>c_compact + 8192 ).
  ENDMETHOD.

  METHOD raw_value.
* value type 3 (CO_VT_RAW on a system): the text base64-decoded
    DATA li_reader TYPE REF TO if_sxml_reader.
    li_reader = reader( cl_abap_codepage=>convert_to( `<a>AQID</a>` ) ).
    li_reader->next_node( ).
    li_reader->next_node( zcl_osd_sxml_stream_reader=>c_vt_raw ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->value_raw
                                        exp = '010203' ).
    cl_abap_unit_assert=>assert_equals( act = li_reader->value_type
                                        exp = zcl_osd_sxml_stream_reader=>c_vt_raw ).
  ENDMETHOD.

  METHOD skip_with_writer.
    DATA li_reader TYPE REF TO if_sxml_reader.
    DATA li_writer TYPE REF TO if_sxml_writer.
    li_reader = reader( cl_abap_codepage=>convert_to( `<a><b/></a>` ) ).
    li_reader->next_node( ).
    li_writer ?= cl_sxml_string_writer=>create( ).
    TRY.
        li_reader->skip_node( li_writer ).
        cl_abap_unit_assert=>fail( `copying to a writer is not implemented` ).
      CATCH cx_sxml_state_error.
        RETURN.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_pull DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS events
      IMPORTING iv_bytes       TYPE xstring
      RETURNING VALUE(rv_trace) TYPE string.
    METHODS documents FOR TESTING RAISING cx_static_check.
    METHODS error_offset FOR TESTING RAISING cx_static_check.
    METHODS utf16_offset FOR TESTING RAISING cx_static_check.
    METHODS declaration_is_bounded FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_pull IMPLEMENTATION.

  METHOD events.
* the events of ZCL_OSD_SXML_PULL over 2-byte chunks, one letter each
    DATA lo_pull TYPE REF TO zcl_osd_sxml_pull.
    DATA lo_source TYPE REF TO zif_osd_byte_source.
    DATA lt_cuts TYPE zcl_osd_bytes_split=>ty_cuts.
    DATA ls_item TYPE zcl_osd_sxml_pull=>ty_item.
    DATA ls_attribute TYPE zcl_osd_sxml_pull=>ty_attribute.
    DATA lv_cut TYPE i VALUE 2.
    DATA lx_error TYPE REF TO cx_sxml_parse_error.
    DATA lv_offset TYPE string.
    WHILE lv_cut < xstrlen( iv_bytes ).
      APPEND lv_cut TO lt_cuts.
      lv_cut = lv_cut + 2.
    ENDWHILE.
    CREATE OBJECT lo_source TYPE zcl_osd_bytes_split
      EXPORTING iv_bytes = iv_bytes
                it_cuts  = lt_cuts.
    CREATE OBJECT lo_pull EXPORTING io_source = lo_source.
    TRY.
        DO 100 TIMES.
          ls_item = lo_pull->next( ).
          CASE ls_item-kind.
            WHEN zcl_osd_sxml_pull=>c_open.
              rv_trace = rv_trace && `<` && ls_item-name && `{` && ls_item-nsuri && `}`.
              LOOP AT ls_item-attrs INTO ls_attribute.
                rv_trace = rv_trace && ` ` && ls_attribute-name && `=` && ls_attribute-value.
              ENDLOOP.
              rv_trace = rv_trace && `>`.
            WHEN zcl_osd_sxml_pull=>c_close.
              rv_trace = rv_trace && `</` && ls_item-name && `>`.
            WHEN zcl_osd_sxml_pull=>c_value.
              rv_trace = rv_trace && `'` && ls_item-value && `'`.
            WHEN zcl_osd_sxml_pull=>c_final.
              rv_trace = rv_trace && `.`.
              RETURN.
          ENDCASE.
        ENDDO.
      CATCH cx_sxml_parse_error INTO lx_error.
        lv_offset = lx_error->xml_offset.
        CONDENSE lv_offset.
        rv_trace = rv_trace && `!` && lv_offset.
    ENDTRY.
  ENDMETHOD.

  METHOD documents.
    cl_abap_unit_assert=>assert_equals(
      act = events( cl_abap_codepage=>convert_to( `<r xmlns="urn:d"><a x="1">t<!--c-->u</a><b/></r>` ) )
      exp = `<r{urn:d}><a{urn:d} x=1>'tu'</a><b{urn:d}></b></r>.` ).
    cl_abap_unit_assert=>assert_equals(
      act = events( cl_abap_codepage=>convert_to( `{"k": [1, true]}` ) )
      exp = `<object{}><array{} name=k><num{}>'1'</num><bool{}>'true'</bool></array></object>.` ).
  ENDMETHOD.

  METHOD error_offset.
* a byte offset: e acute and euro are 5 bytes, the wrong close tag at 8
    cl_abap_unit_assert=>assert_equals(
      act = events( cl_abap_codepage=>convert_to( `<a>` && cl_abap_codepage=>convert_from( 'C3A9E282AC' ) && `</b>` ) )
      exp = `<a{}>'` && cl_abap_codepage=>convert_from( 'C3A9E282AC' ) && `'!8` ).
  ENDMETHOD.

  METHOD utf16_offset.
* in the input's bytes, the BOM not counted, as a system counts it (A4H:
* UTF-16 <a></b> is 6; ANORMALIES 2026-10-01-sxml-stream-transcoded-offsets)
    cl_abap_unit_assert=>assert_equals(
      act = events( 'FFFE3C0061003E003C002F0062003E00' )
      exp = `<a{}>!6` ).
* two code units of e acute: 10 (the UTF-8 count would be 7)
    cl_abap_unit_assert=>assert_equals(
      act = events( 'FFFE3C0061003E00E900E9003C002F0062003E00' )
      exp = `<a{}>'` && cl_abap_codepage=>convert_from( 'C3A9C3A9' ) && `'!10` ).
* U+1F600 as a surrogate pair is 4 bytes, then e acute 2: 12 (UTF-8: 9)
    cl_abap_unit_assert=>assert_equals(
      act = events( 'FFFE3C0061003E003DD800DEE9003C002F0062003E00' )
      exp = `<a{}>'` && cl_abap_codepage=>convert_from( 'F09F9880C3A9' ) && `'!12` ).
  ENDMETHOD.

  METHOD declaration_is_bounded.
* a '<?xml' without '?>' in its first 1024 bytes is no declaration; the
* document is then read as it is (here: no root element, the end)
    DATA lv_doc TYPE string.
    lv_doc = `<?xml version="1.0" encoding="x"`.
    DO 200 TIMES.
      lv_doc = lv_doc && `     `.
    ENDDO.
    lv_doc = lv_doc && `?><a/>`.
    cl_abap_unit_assert=>assert_equals(
      act = events( cl_abap_codepage=>convert_to( lv_doc ) )
      exp = `<a{}></a>.` ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_dataset DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS round_trip FOR TESTING RAISING cx_static_check.
    METHODS missing_file FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_dataset IMPLEMENTATION.

  METHOD round_trip.
* written with TRANSFER, read back in 7-byte chunks, then empty forever;
* needs a dataset write root (OSD_DATASET_WRITE on this runtime), and a run
* without one has nothing to test here
    DATA lv_file TYPE string VALUE `osd_byte_source_test.bin`.
    DATA lv_message TYPE string.
    DATA lv_data TYPE xstring VALUE '000102030405060708090A0B0C0D0E0F10111213FF'.
    DATA lo_source TYPE REF TO zcl_osd_byte_source_dataset.
    DATA lv_chunk TYPE xstring.
    DATA lv_all TYPE xstring.
    DATA lv_chunks TYPE i.
    OPEN DATASET lv_file FOR OUTPUT IN BINARY MODE MESSAGE lv_message.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    TRANSFER lv_data TO lv_file.
    CLOSE DATASET lv_file.
    CREATE OBJECT lo_source
      EXPORTING iv_file  = lv_file
                iv_chunk = 7.
    DO.
      lv_chunk = lo_source->zif_osd_byte_source~next( ).
      IF xstrlen( lv_chunk ) = 0.
        EXIT.
      ENDIF.
      cl_abap_unit_assert=>assert_number_between( number = xstrlen( lv_chunk )
                                                  lower  = 1
                                                  upper  = 7 ).
      lv_chunks = lv_chunks + 1.
      CONCATENATE lv_all lv_chunk INTO lv_all IN BYTE MODE.
    ENDDO.
    cl_abap_unit_assert=>assert_initial( lo_source->zif_osd_byte_source~next( ) ).
    cl_abap_unit_assert=>assert_initial( lo_source->zif_osd_byte_source~next( ) ).
    lo_source->close( ).
    DELETE DATASET lv_file.
    cl_abap_unit_assert=>assert_equals( act = lv_all
                                        exp = lv_data ).
    cl_abap_unit_assert=>assert_equals( act = lv_chunks
                                        exp = 3 ).
  ENDMETHOD.

  METHOD missing_file.
    DATA lo_source TYPE REF TO zcl_osd_byte_source_dataset.
    DATA lx_error TYPE REF TO zcx_osd_byte_source.
    TRY.
        CREATE OBJECT lo_source EXPORTING iv_file = `osd_byte_source_test_missing.bin`.
        cl_abap_unit_assert=>fail( `a file that is not there cannot be read` ).
      CATCH zcx_osd_byte_source INTO lx_error.
        cl_abap_unit_assert=>assert_char_cp( act = lx_error->reason
                                             exp = 'cannot open *' ).
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
