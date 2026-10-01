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
    cl_abap_unit_assert=>assert_number_between( number = lo_reader->peak_window
                                                lower  = 4096
                                                upper  = zcl_osd_sxml_stream_reader=>c_compact + 8192 ).
  ENDMETHOD.

ENDCLASS.
