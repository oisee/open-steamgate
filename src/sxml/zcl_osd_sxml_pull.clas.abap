"! A streaming pull parser for XML (and JSON as JSON-XML) over a
"! ZIF_OSD_BYTE_SOURCE. It implements no SAP interface on purpose, so it
"! activates on any system as it is; ZCL_OSD_SXML_STREAM_READER puts the
"! IF_SXML_READER face of this repository's runtime on it.
"!
"! The document is never held whole. The parser keeps a WINDOW of the byte
"! stream (absolute positions, MV_BASE is the position of its first byte),
"! asks the source for another chunk when a position or a search needs
"! bytes beyond it, and drops the bytes before the current token once more
"! than C_COMPACT of them are consumed. Memory is that window and the stack
"! of open elements with their namespace bindings. The window holds the
"! longest single construct whole: a text value, a tag with its attributes,
"! and equally a comment, a processing instruction, a CDATA section or a
"! run of white space outside the root element, however long. An XML
"! declaration is looked for in the first 1024 bytes only. Positions are
"! type i, so a document is under 2 GiB.
"!
"! The parser is a port of open-abap-core's CL_SXML_STRING_READER (local
"! class lcl_xml_parser, the byte-mode version of oisee/open-abap-core
"! 8b397be), MIT License, Copyright (c) 2020 open-abap. Where the sXML
"! contract (ZCL_OSD_SXML_CONTRACT, expectations measured on a system)
"! differs from that parser, the contract wins.
"!
"! Input: UTF-8 (with or without BOM, declared or not) is read in its bytes
"! and error offsets are byte offsets in it, a UTF-8 BOM included. A UTF-16
"! BOM or a declared ISO-8859-1 / US-ASCII is transcoded to UTF-8 chunk by
"! chunk (ZCL_OSD_BYTES_TO_UTF8), and error offsets then count the bytes of
"! that UTF-8 stream, not of the input; any other declared encoding drains
"! the source and decodes it with CL_ABAP_CONV_IN_CE. JSON (first character
"! not '<') is read as JSON-XML, also streaming.
"!
"! The parser never closes its source: whoever opened it closes it, also
"! after a CX_SXML_PARSE_ERROR (ZCL_OSD_BYTE_SOURCE_DATASET closes itself
"! at its end).
CLASS zcl_osd_sxml_pull DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! what NEXT returns: the values of IF_SXML_NODE=>CO_NT_*
    CONSTANTS c_open TYPE i VALUE 1.
    CONSTANTS c_close TYPE i VALUE 2.
    CONSTANTS c_value TYPE i VALUE 4.
    CONSTANTS c_final TYPE i VALUE 128.

    TYPES: BEGIN OF ty_attribute,
             name   TYPE string,
             prefix TYPE string,
             nsuri  TYPE string,
             value  TYPE string,
           END OF ty_attribute.
    TYPES ty_attributes TYPE STANDARD TABLE OF ty_attribute WITH DEFAULT KEY.
    "! one event: an element opens (with its attributes), closes, a value,
    "! or the end of the document
    TYPES: BEGIN OF ty_item,
             kind   TYPE i,
             name   TYPE string,
             prefix TYPE string,
             nsuri  TYPE string,
             value  TYPE string,
             attrs  TYPE ty_attributes,
           END OF ty_item.
    TYPES: BEGIN OF ty_nsbinding,
             prefix TYPE string,
             nsuri  TYPE string,
           END OF ty_nsbinding.
    TYPES ty_nsbindings TYPE HASHED TABLE OF ty_nsbinding WITH UNIQUE KEY prefix.
    TYPES: BEGIN OF ty_pathnode,
             name           TYPE string,
             nsuri          TYPE string,
             prefix         TYPE string,
             child_position TYPE i,
           END OF ty_pathnode.
    TYPES ty_path TYPE STANDARD TABLE OF ty_pathnode WITH DEFAULT KEY.

    "! consumed bytes kept before the window is cut down
    CONSTANTS c_compact TYPE i VALUE 65536.
    "! how far the XML declaration is looked for
    CONSTANTS c_declaration TYPE i VALUE 1024.

    "! the reason of the last CX_SXML_PARSE_ERROR raised
    DATA last_error TYPE string READ-ONLY.
    "! the largest the window has been, in bytes
    DATA peak_window TYPE i READ-ONLY.

    METHODS constructor
      IMPORTING io_source TYPE REF TO zif_osd_byte_source.
    "! the next event of the document; after the end, the end again
    METHODS next
      RETURNING VALUE(rs_item) TYPE ty_item
      RAISING   cx_sxml_parse_error.
    "! white space only between tags is a value too (default: dropped
    "! before a start tag and in an element with child elements)
    METHODS set_keep_whitespace
      IMPORTING iv_keep TYPE abap_bool DEFAULT abap_true.
    "! the byte offset the parser has reached
    METHODS get_byte_offset
      RETURNING VALUE(rv_offset) TYPE i.
    "! the open elements from the root down, each with its position among
    "! its parent's child elements
    METHODS get_path
      RETURNING VALUE(rt_path) TYPE ty_path.
    "! the namespace bindings in scope
    METHODS get_nsbindings
      RETURNING VALUE(rt_nsbindings) TYPE ty_nsbindings.
    METHODS get_nsuri_by_prefix
      IMPORTING iv_prefix      TYPE string
      RETURNING VALUE(rv_nsuri) TYPE string.
    METHODS get_prefix_by_nsuri
      IMPORTING iv_nsuri        TYPE string
      RETURNING VALUE(rv_prefix) TYPE string.
    "! one UTF-16 code unit as a character, surrogates included
    CLASS-METHODS code_unit
      IMPORTING iv_code      TYPE i
      RETURNING VALUE(rv_char) TYPE string.
    "! one code point, as one character or a surrogate pair
    CLASS-METHODS code_point
      IMPORTING iv_code      TYPE i
      RETURNING VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    TYPES ty_byte TYPE x LENGTH 1.
    TYPES ty_c1 TYPE c LENGTH 1.
    TYPES: BEGIN OF ty_element,
             name       TYPE string,
             local_name TYPE string,
             prefix     TYPE string,
             nsuri      TYPE string,
             has_child  TYPE abap_bool,
             children   TYPE i,
           END OF ty_element.
    TYPES: BEGIN OF ty_binding,
             depth        TYPE i,
             prefix       TYPE string,
             nsuri        TYPE string,
             previous     TYPE string,
             had_previous TYPE abap_bool,
           END OF ty_binding.
    TYPES: BEGIN OF ty_frame,
             kind  TYPE c LENGTH 1,
             state TYPE c LENGTH 1,
           END OF ty_frame.
    TYPES ty_items TYPE STANDARD TABLE OF ty_item WITH DEFAULT KEY.

    CONSTANTS c_lt TYPE ty_byte VALUE '3C'.
    CONSTANTS c_gt TYPE ty_byte VALUE '3E'.
    CONSTANTS c_slash TYPE ty_byte VALUE '2F'.
    CONSTANTS c_quest TYPE ty_byte VALUE '3F'.
    CONSTANTS c_bang TYPE ty_byte VALUE '21'.
    CONSTANTS c_eq TYPE ty_byte VALUE '3D'.
    CONSTANTS c_dquote TYPE ty_byte VALUE '22'.
    CONSTANTS c_squote TYPE ty_byte VALUE '27'.
    CONSTANTS c_space TYPE ty_byte VALUE '20'.
    CONSTANTS c_tab TYPE ty_byte VALUE '09'.
    CONSTANTS c_lf TYPE ty_byte VALUE '0A'.
    CONSTANTS c_cr TYPE ty_byte VALUE '0D'.
    CONSTANTS c_amp TYPE ty_byte VALUE '26'.
    CONSTANTS c_semi TYPE ty_byte VALUE '3B'.
    CONSTANTS c_backslash TYPE ty_byte VALUE '5C'.
    CONSTANTS c_comma TYPE ty_byte VALUE '2C'.
    CONSTANTS c_colon TYPE ty_byte VALUE '3A'.
    CONSTANTS c_lbrace TYPE ty_byte VALUE '7B'.
    CONSTANTS c_rbrace TYPE ty_byte VALUE '7D'.
    CONSTANTS c_lbracket TYPE ty_byte VALUE '5B'.
    CONSTANTS c_rbracket TYPE ty_byte VALUE '5D'.

    CLASS-DATA gv_order TYPE c LENGTH 1.
    CLASS-METHODS lone_surrogate
      IMPORTING iv_code        TYPE i
      RETURNING VALUE(rv_char) TYPE string.

    DATA mo_source TYPE REF TO zif_osd_byte_source.
    DATA mv_buf TYPE xstring.
    DATA mv_base TYPE i.
    DATA mv_eof TYPE abap_bool.
    DATA mv_pos TYPE i.
    DATA mv_started TYPE abap_bool.
    DATA mv_json TYPE abap_bool.
    DATA mv_done TYPE abap_bool.
    DATA mv_pending_close TYPE abap_bool.
    DATA mv_keep_whitespace TYPE abap_bool.
    DATA mt_elements TYPE STANDARD TABLE OF ty_element WITH DEFAULT KEY.
    DATA mv_root_children TYPE i.
    DATA mt_bindings TYPE STANDARD TABLE OF ty_binding WITH DEFAULT KEY.
    DATA mt_current TYPE ty_nsbindings.
    DATA mt_frames TYPE STANDARD TABLE OF ty_frame WITH DEFAULT KEY.
    DATA mv_json_top TYPE abap_bool.
    DATA mt_queue TYPE ty_items.

    " the window
    METHODS fill
      RETURNING VALUE(rv_more) TYPE abap_bool.
    METHODS has
      IMPORTING iv_pos       TYPE i
      RETURNING VALUE(rv_has) TYPE abap_bool.
    METHODS byte_at
      IMPORTING iv_pos        TYPE i
      RETURNING VALUE(rv_byte) TYPE ty_byte.
    METHODS compact.
    METHODS seek
      IMPORTING iv_needle      TYPE xstring
                iv_off         TYPE i
      RETURNING VALUE(rv_found) TYPE i.
    METHODS scan
      IMPORTING iv_needle      TYPE xstring
                iv_from        TYPE i
                iv_to          TYPE i
      RETURNING VALUE(rv_found) TYPE i.
    METHODS find_slice
      IMPORTING iv_needle      TYPE xstring
                iv_from        TYPE i
                iv_length      TYPE i
      RETURNING VALUE(rv_found) TYPE i.
    METHODS find_in
      IMPORTING iv_byte        TYPE ty_byte
                iv_from        TYPE i
                iv_to          TYPE i
      RETURNING VALUE(rv_found) TYPE i.
    METHODS starts
      IMPORTING iv_needle    TYPE xstring
      RETURNING VALUE(rv_yes) TYPE abap_bool.
    METHODS bytes
      IMPORTING iv_begin       TYPE i
                iv_length      TYPE i
      RETURNING VALUE(rv_bytes) TYPE xstring.

    " decoding
    METHODS piece
      IMPORTING iv_begin       TYPE i
                iv_length      TYPE i
      RETURNING VALUE(rv_text) TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS replaced
      IMPORTING iv_part        TYPE xstring
                iv_begin       TYPE i
      RETURNING VALUE(rv_text) TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS text_of
      IMPORTING iv_begin       TYPE i
                iv_end         TYPE i
      RETURNING VALUE(rv_text) TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS entity
      IMPORTING iv_name        TYPE string
                iv_at          TYPE i
      RETURNING VALUE(rv_text) TYPE string
      RAISING   cx_sxml_parse_error.

    " the XML parser
    METHODS start
      RAISING cx_sxml_parse_error.
    METHODS transcode
      IMPORTING iv_from TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS fail
      IMPORTING iv_reason TYPE string
                iv_at     TYPE i
      RAISING   cx_sxml_parse_error.
    METHODS whitespace.
    METHODS is_space
      IMPORTING iv_byte       TYPE ty_byte
      RETURNING VALUE(rv_yes) TYPE abap_bool.
    METHODS take_name
      RETURNING VALUE(rv_name) TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS restore
      IMPORTING iv_depth TYPE i.
    METHODS close_element
      RETURNING VALUE(rs_item) TYPE ty_item.
    METHODS open_element
      RETURNING VALUE(rs_item) TYPE ty_item
      RAISING   cx_sxml_parse_error.
    METHODS xml_next
      RETURNING VALUE(rs_item) TYPE ty_item
      RAISING   cx_sxml_parse_error.

    " the JSON parser
    METHODS json_next
      RETURNING VALUE(rs_item) TYPE ty_item
      RAISING   cx_sxml_parse_error.
    METHODS json_value
      IMPORTING iv_key         TYPE string
                iv_has_key     TYPE abap_bool
      RETURNING VALUE(rs_item) TYPE ty_item
      RAISING   cx_sxml_parse_error.
    METHODS json_string
      RETURNING VALUE(rv_text) TYPE string
      RAISING   cx_sxml_parse_error.
    METHODS json_close
      RETURNING VALUE(rs_item) TYPE ty_item.

ENDCLASS.


CLASS zcl_osd_sxml_pull IMPLEMENTATION.

  METHOD lone_surrogate.
* a surrogate code unit standing alone, which no code page conversion
* produces: built in memory by casting, in the byte order of this host
* (found once, from a character whose code is known)
    DATA lv_probe TYPE x LENGTH 2 VALUE '4100'.
    DATA lv_hex TYPE x LENGTH 2.
    DATA lv_swap TYPE x LENGTH 2.
    DATA lv_char TYPE ty_c1.
    FIELD-SYMBOLS <lv_char> TYPE ty_c1.
    IF gv_order IS INITIAL.
      ASSIGN lv_probe TO <lv_char> CASTING.
      IF <lv_char> = 'A'.
        gv_order = 'L'.
      ELSE.
        gv_order = 'B'.
      ENDIF.
    ENDIF.
    lv_hex = iv_code.
    IF gv_order = 'L'.
      CONCATENATE lv_hex+1(1) lv_hex(1) INTO lv_swap IN BYTE MODE.
      lv_hex = lv_swap.
    ENDIF.
    ASSIGN lv_hex TO <lv_char> CASTING.
    lv_char = <lv_char>.
    rv_char = lv_char.
  ENDMETHOD.

  METHOD constructor.
    mo_source = io_source.
  ENDMETHOD.

  METHOD code_unit.
    DATA lv_char TYPE ty_c1.
    IF iv_code = 32.
      rv_char = ` `.
    ELSEIF iv_code >= 55296 AND iv_code <= 57343.
      rv_char = lone_surrogate( iv_code ).
    ELSE.
      lv_char = cl_abap_conv_in_ce=>uccpi( iv_code ).
      rv_char = lv_char.
    ENDIF.
  ENDMETHOD.

  METHOD code_point.
* above U+FFFF through its UTF-8 form, so every host spells it its own way
* (a surrogate pair in a UTF-16 string)
    DATA lv_utf8 TYPE xstring.
    DATA lv_b TYPE x LENGTH 1.
    DATA lv_c TYPE x LENGTH 1.
    DATA lv_d TYPE x LENGTH 1.
    DATA lv_e TYPE x LENGTH 1.
    IF iv_code < 65536.
      rv_text = code_unit( iv_code ).
      RETURN.
    ENDIF.
    lv_b = 240 + iv_code DIV 262144.
    lv_c = 128 + ( iv_code DIV 4096 ) MOD 64.
    lv_d = 128 + ( iv_code DIV 64 ) MOD 64.
    lv_e = 128 + iv_code MOD 64.
    CONCATENATE lv_b lv_c lv_d lv_e INTO lv_utf8 IN BYTE MODE.
    rv_text = cl_abap_codepage=>convert_from( lv_utf8 ).
  ENDMETHOD.


  METHOD fill.
    DATA lv_chunk TYPE xstring.
    IF mv_eof = abap_true.
      RETURN.
    ENDIF.
    lv_chunk = mo_source->next( ).
    IF xstrlen( lv_chunk ) = 0.
      mv_eof = abap_true.
      RETURN.
    ENDIF.
    CONCATENATE mv_buf lv_chunk INTO mv_buf IN BYTE MODE.
    IF xstrlen( mv_buf ) > peak_window.
      peak_window = xstrlen( mv_buf ).
    ENDIF.
    rv_more = abap_true.
  ENDMETHOD.

  METHOD has.
    WHILE iv_pos >= mv_base + xstrlen( mv_buf ).
      IF fill( ) = abap_false.
        RETURN.
      ENDIF.
    ENDWHILE.
    rv_has = abap_true.
  ENDMETHOD.

  METHOD byte_at.
    DATA lv_off TYPE i.
    lv_off = iv_pos - mv_base.
    rv_byte = mv_buf+lv_off(1).
  ENDMETHOD.

  METHOD compact.
* drop what is consumed, in steps of at least C_COMPACT so the copy is paid
* once per that many bytes; nothing before MV_POS is read again
    DATA lv_off TYPE i.
    lv_off = mv_pos - mv_base.
    IF lv_off >= xstrlen( mv_buf ) AND lv_off > 0.
      CLEAR mv_buf.
      mv_base = mv_pos.
    ELSEIF lv_off >= c_compact.
      mv_buf = mv_buf+lv_off.
      mv_base = mv_pos.
    ENDIF.
  ENDMETHOD.

  METHOD seek.
* the first IV_NEEDLE at or after IV_OFF, loading chunks until it is found
* or the stream ends (-1); a needle cut by a chunk boundary is found once
* the second half is in, since the next search restarts NEEDLE-1 earlier
    DATA lv_from TYPE i.
    DATA lv_end TYPE i.
    lv_from = iv_off.
    DO.
      lv_end = mv_base + xstrlen( mv_buf ).
      rv_found = scan( iv_needle = iv_needle
                       iv_from   = lv_from
                       iv_to     = lv_end ).
      IF rv_found >= 0.
        RETURN.
      ENDIF.
      lv_from = lv_end - xstrlen( iv_needle ) + 1.
      IF lv_from < iv_off.
        lv_from = iv_off.
      ENDIF.
      IF fill( ) = abap_false.
        rv_found = -1.
        RETURN.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD scan.
* IV_NEEDLE in [IV_FROM, IV_TO) of the window, or -1. Searched in slices
* that start small and double, so finding a needle costs about the distance
* to it, whatever the size of the window
    DATA lv_n TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_size TYPE i VALUE 256.
    DATA lv_take TYPE i.
    lv_n = xstrlen( iv_needle ).
    rv_found = -1.
    lv_pos = iv_from.
    WHILE lv_pos + lv_n <= iv_to.
      lv_take = lv_size + lv_n - 1.
      IF lv_pos + lv_take > iv_to.
        lv_take = iv_to - lv_pos.
      ENDIF.
      rv_found = find_slice( iv_needle = iv_needle
                             iv_from   = lv_pos
                             iv_length = lv_take ).
      IF rv_found >= 0.
        RETURN.
      ENDIF.
      lv_pos = lv_pos + lv_take - lv_n + 1.
      IF lv_size < c_compact.
        lv_size = lv_size * 2.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

  METHOD find_slice.
* every match is checked against the bytes: a FIND IN BYTE MODE that
* matches the hex text can report a needle that straddles two bytes
    DATA lv_slice TYPE xstring.
    DATA lv_n TYPE i.
    DATA lv_off TYPE i.
    DATA lv_found TYPE i.
    rv_found = -1.
    lv_n = xstrlen( iv_needle ).
    lv_slice = bytes( iv_begin  = iv_from
                      iv_length = iv_length ).
    WHILE lv_off + lv_n <= iv_length.
      FIND iv_needle IN SECTION OFFSET lv_off OF lv_slice IN BYTE MODE MATCH OFFSET lv_found.
      IF sy-subrc <> 0.
        RETURN.
      ENDIF.
      IF lv_found >= 0 AND lv_found + lv_n <= iv_length.
        IF lv_slice+lv_found(lv_n) = iv_needle.
          rv_found = iv_from + lv_found.
          RETURN.
        ENDIF.
      ENDIF.
      lv_off = lv_found + 1.
      IF lv_off <= 0.
        lv_off = 1.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

  METHOD find_in.
* IV_BYTE in [IV_FROM, IV_TO), all of it in the window, or -1
    DATA lv_needle TYPE xstring.
    lv_needle = iv_byte.
    rv_found = scan( iv_needle = lv_needle
                     iv_from   = iv_from
                     iv_to     = iv_to ).
  ENDMETHOD.

  METHOD starts.
    DATA lv_n TYPE i.
    DATA lv_rel TYPE i.
    lv_n = xstrlen( iv_needle ).
    IF has( mv_pos + lv_n - 1 ) = abap_false.
      RETURN.
    ENDIF.
    lv_rel = mv_pos - mv_base.
    IF mv_buf+lv_rel(lv_n) = iv_needle.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD bytes.
    DATA lv_rel TYPE i.
    IF iv_length <= 0.
      RETURN.
    ENDIF.
    lv_rel = iv_begin - mv_base.
    rv_bytes = mv_buf+lv_rel(iv_length).
  ENDMETHOD.


  METHOD piece.
* the bytes [IV_BEGIN, IV_BEGIN + IV_LENGTH) as text. Valid UTF-8 goes
* through the code page conversion, checked by converting back (a host
* that replaces instead of raising fails the round trip); anything else
* is decoded by REPLACED with the rules measured on a system
    DATA lv_part TYPE xstring.
    DATA lv_back TYPE xstring.
    DATA lv_ok TYPE abap_bool.
    IF iv_length <= 0.
      RETURN.
    ENDIF.
    lv_part = bytes( iv_begin  = iv_begin
                     iv_length = iv_length ).
    TRY.
        rv_text = cl_abap_codepage=>convert_from( lv_part ).
        lv_back = cl_abap_codepage=>convert_to( rv_text ).
        IF lv_back = lv_part.
          lv_ok = abap_true.
        ENDIF.
      CATCH cx_root.
        lv_ok = abap_false.
    ENDTRY.
    IF lv_ok = abap_false.
      rv_text = replaced( iv_part  = lv_part
                          iv_begin = iv_begin ).
    ENDIF.
  ENDMETHOD.

  METHOD replaced.
* UTF-8 decoded byte by byte, as a system reads it: a byte that neither
* starts nor continues a character is one U+FFFD (a lone 80; E2 82 before
* more text is two); an overlong C0/C1 pair is one U+FFFD for both bytes;
* an encoded surrogate (ED A0 80) passes through as the lone code unit; a
* sequence cut off by the end of the piece -- the markup after it -- is an
* error at that markup (E2 82 then '<')
    DATA lv_pos TYPE i.
    DATA lv_len TYPE i.
    DATA lv_byte TYPE ty_byte.
    DATA lv_lead TYPE i.
    DATA lv_next TYPE i.
    DATA lv_size TYPE i.
    DATA lv_code TYPE i.
    DATA lv_k TYPE i.
    DATA lv_good TYPE abap_bool.
    DATA lv_low TYPE i.
    DATA lv_high TYPE i.
    DATA lv_at TYPE i.
    lv_len = xstrlen( iv_part ).
    WHILE lv_pos < lv_len.
      lv_byte = iv_part+lv_pos(1).
      lv_lead = lv_byte.
      IF lv_lead < 128.
        rv_text = rv_text && code_unit( lv_lead ).
        lv_pos = lv_pos + 1.
        CONTINUE.
      ENDIF.
      IF lv_lead = 192 OR lv_lead = 193.
        IF lv_pos + 2 <= lv_len.
          rv_text = rv_text && code_unit( 65533 ).
          lv_pos = lv_pos + 2.
        ELSE.
          rv_text = rv_text && code_unit( 65533 ).
          lv_pos = lv_pos + 1.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF lv_lead >= 194 AND lv_lead <= 223.
        lv_size = 2.
        lv_code = lv_lead - 192.
      ELSEIF lv_lead >= 224 AND lv_lead <= 239.
        lv_size = 3.
        lv_code = lv_lead - 224.
      ELSEIF lv_lead >= 240 AND lv_lead <= 244.
        lv_size = 4.
        lv_code = lv_lead - 240.
      ELSE.
        rv_text = rv_text && code_unit( 65533 ).
        lv_pos = lv_pos + 1.
        CONTINUE.
      ENDIF.
      IF lv_pos + lv_size > lv_len.
        lv_at = iv_begin + lv_len.
        fail( iv_reason = 'invalid UTF-8 sequence'
              iv_at     = lv_at ).
      ENDIF.
* the second byte's range depends on the lead (no overlong form, nothing
* above U+10FFFF); ED A0..BF is a surrogate and passes
      lv_low = 128.
      lv_high = 191.
      IF lv_lead = 224.
        lv_low = 160.
      ELSEIF lv_lead = 240.
        lv_low = 144.
      ELSEIF lv_lead = 244.
        lv_high = 143.
      ENDIF.
      lv_good = abap_true.
      lv_k = 1.
      WHILE lv_k < lv_size.
        lv_at = lv_pos + lv_k.
        lv_byte = iv_part+lv_at(1).
        lv_next = lv_byte.
        IF lv_k = 1 AND ( lv_next < lv_low OR lv_next > lv_high ).
          lv_good = abap_false.
          EXIT.
        ELSEIF lv_next < 128 OR lv_next > 191.
          lv_good = abap_false.
          EXIT.
        ENDIF.
        lv_code = lv_code * 64 + lv_next - 128.
        lv_k = lv_k + 1.
      ENDWHILE.
      IF lv_good = abap_true.
        rv_text = rv_text && code_point( lv_code ).
        lv_pos = lv_pos + lv_size.
      ELSE.
        rv_text = rv_text && code_unit( 65533 ).
        lv_pos = lv_pos + 1.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

  METHOD text_of.
* character data [IV_BEGIN, IV_END) with its references resolved; a bad
* reference is an error where its '&' stands
    DATA lv_pos TYPE i.
    DATA lv_amp TYPE i.
    DATA lv_semi TYPE i.
    DATA lv_name TYPE string.
    lv_pos = iv_begin.
    WHILE lv_pos < iv_end.
      lv_amp = find_in( iv_byte = c_amp
                        iv_from = lv_pos
                        iv_to   = iv_end ).
      IF lv_amp < 0.
        rv_text = rv_text && piece( iv_begin  = lv_pos
                                    iv_length = iv_end - lv_pos ).
        RETURN.
      ENDIF.
      rv_text = rv_text && piece( iv_begin  = lv_pos
                                  iv_length = lv_amp - lv_pos ).
      lv_semi = find_in( iv_byte = c_semi
                         iv_from = lv_amp + 1
                         iv_to   = iv_end ).
      IF lv_semi < 0.
        fail( iv_reason = 'unresolveable entity reference in content'
              iv_at     = lv_amp ).
      ENDIF.
      lv_name = piece( iv_begin  = lv_amp + 1
                       iv_length = lv_semi - lv_amp - 1 ).
      rv_text = rv_text && entity( iv_name = lv_name
                                   iv_at   = lv_amp ).
      lv_pos = lv_semi + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD entity.
    DATA lv_base TYPE i.
    DATA lv_begin TYPE i.
    DATA lv_code TYPE i.
    DATA lv_digit TYPE i.
    DATA lv_c TYPE c LENGTH 1.
    DATA lv_chars TYPE string VALUE '0123456789ABCDEF'.
    CASE iv_name.
      WHEN 'amp'.
        rv_text = '&'.
      WHEN 'lt'.
        rv_text = '<'.
      WHEN 'gt'.
        rv_text = '>'.
      WHEN 'quot'.
        rv_text = '"'.
      WHEN 'apos'.
        rv_text = ''''.
      WHEN OTHERS.
        IF strlen( iv_name ) < 2 OR iv_name(1) <> '#'.
          fail( iv_reason = 'unresolveable entity reference in content'
                iv_at     = iv_at ).
        ENDIF.
        lv_base = 10.
        lv_begin = 1.
        IF iv_name+1(1) = 'x' OR iv_name+1(1) = 'X'.
          lv_base = 16.
          lv_begin = 2.
        ENDIF.
        IF lv_begin >= strlen( iv_name ).
          fail( iv_reason = 'unresolveable entity reference in content'
                iv_at     = iv_at ).
        ENDIF.
        WHILE lv_begin < strlen( iv_name ).
          lv_c = iv_name+lv_begin(1).
          TRANSLATE lv_c TO UPPER CASE.
          FIND lv_c IN lv_chars MATCH OFFSET lv_digit.
          IF sy-subrc <> 0 OR lv_digit >= lv_base.
            fail( iv_reason = 'unresolveable entity reference in content'
                  iv_at     = iv_at ).
          ENDIF.
          IF lv_code > ( 1114111 - lv_digit ) DIV lv_base.
            fail( iv_reason = 'illegal charref value'
                  iv_at     = iv_at ).
          ENDIF.
          lv_code = lv_code * lv_base + lv_digit.
          lv_begin = lv_begin + 1.
        ENDWHILE.
        IF lv_code >= 55296 AND lv_code <= 57343.
          fail( iv_reason = 'illegal charref value'
                iv_at     = iv_at ).
        ENDIF.
        rv_text = code_point( lv_code ).
    ENDCASE.
  ENDMETHOD.


  METHOD fail.
    DATA lx_error TYPE REF TO cx_sxml_parse_error.
    last_error = iv_reason.
    CREATE OBJECT lx_error EXPORTING xml_offset = iv_at.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.

  METHOD start.
* the kind of the input, from its first bytes: a BOM, else the first byte
* that is not white space ('<' is XML, anything else JSON), else for XML
* the encoding of its declaration
    DATA lv_byte TYPE ty_byte.
    DATA lv_end TYPE i.
    DATA lv_decl TYPE string.
    DATA lv_encoding TYPE string.
    DATA lv_start TYPE i.
    DATA lv_bom TYPE abap_bool.
    DATA lv_limit TYPE i.
    mv_started = abap_true.
    lv_bom = abap_true.
    IF starts( 'EFBBBF' ) = abap_true.
      mv_pos = 3.
    ELSEIF starts( 'FFFE' ) = abap_true.
      mv_pos = 2.
      transcode( 'UTF-16LE' ).
    ELSEIF starts( 'FEFF' ) = abap_true.
      mv_pos = 2.
      transcode( 'UTF-16BE' ).
    ELSE.
      lv_bom = abap_false.
    ENDIF.
    lv_start = mv_pos.
    whitespace( ).
    IF has( mv_pos ) = abap_true.
      lv_byte = byte_at( mv_pos ).
      IF lv_byte <> c_lt.
        mv_json = abap_true.
        RETURN.
      ENDIF.
    ELSEIF mv_pos > 0.
      mv_json = abap_true.
      RETURN.
    ENDIF.
    mv_pos = lv_start.
* a declared encoding counts only without a BOM, and only at the start
    IF lv_bom = abap_true OR starts( '3C3F786D6C' ) = abap_false. " <?xml
      RETURN.
    ENDIF.
* the declaration's end within the first C_DECLARATION bytes, never further:
* a '<?xml' that does not end there loads no more of the document
    has( c_declaration - 1 ).
    lv_limit = mv_base + xstrlen( mv_buf ).
    IF lv_limit > c_declaration.
      lv_limit = c_declaration.
    ENDIF.
    lv_end = scan( iv_needle = '3F3E'
                   iv_from   = lv_start
                   iv_to     = lv_limit ).
    IF lv_end < 0.
      RETURN.
    ENDIF.
    TRY.
        lv_decl = cl_abap_codepage=>convert_from( bytes( iv_begin  = 0
                                                         iv_length = lv_end ) ).
      CATCH cx_root.
        RETURN.
    ENDTRY.
    FIND REGEX `encoding[ ]*=[ ]*['"]([^'"]+)['"]` IN lv_decl SUBMATCHES lv_encoding.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    TRANSLATE lv_encoding TO UPPER CASE.
    IF lv_encoding = 'UTF-8' OR lv_encoding = 'UTF8'.
      RETURN.
    ENDIF.
    transcode( lv_encoding ).
  ENDMETHOD.

  METHOD transcode.
* the rest of the stream, from MV_POS, as UTF-8; positions start again at 0
    DATA lo_utf8 TYPE REF TO zcl_osd_bytes_to_utf8.
    DATA lo_whole TYPE REF TO zcl_osd_bytes_whole.
    DATA lv_rest TYPE xstring.
    DATA lv_chunk TYPE xstring.
    DATA lv_text TYPE string.
    DATA lv_encoding TYPE abap_encoding.
    DATA lo_conv TYPE REF TO cl_abap_conv_in_ce.
    lv_rest = bytes( iv_begin  = mv_pos
                     iv_length = mv_base + xstrlen( mv_buf ) - mv_pos ).
    IF zcl_osd_bytes_to_utf8=>supports( iv_from ) = abap_true.
      CREATE OBJECT lo_utf8
        EXPORTING io_source = mo_source
                  iv_head   = lv_rest
                  iv_from   = iv_from.
      mo_source = lo_utf8.
    ELSE.
* not one the stream transcodes: the whole document, decoded at once
      IF mv_eof = abap_false.
        DO.
          lv_chunk = mo_source->next( ).
          IF xstrlen( lv_chunk ) = 0.
            EXIT.
          ENDIF.
          CONCATENATE lv_rest lv_chunk INTO lv_rest IN BYTE MODE.
        ENDDO.
      ENDIF.
      TRY.
          lv_encoding = iv_from.
          lo_conv = cl_abap_conv_in_ce=>create( encoding = lv_encoding ).
          lo_conv->convert( EXPORTING input = lv_rest
                            IMPORTING data  = lv_text ).
          lv_rest = cl_abap_codepage=>convert_to( lv_text ).
        CATCH cx_root.
          fail( iv_reason = 'BOM / charset detection failed'
                iv_at     = 0 ).
      ENDTRY.
      CREATE OBJECT lo_whole EXPORTING iv_bytes = lv_rest.
      mo_source = lo_whole.
    ENDIF.
    CLEAR mv_buf.
    mv_base = 0.
    mv_pos = 0.
    mv_eof = abap_false.
  ENDMETHOD.

  METHOD is_space.
    IF iv_byte = c_space OR iv_byte = c_tab OR iv_byte = c_lf OR iv_byte = c_cr.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD whitespace.
    WHILE has( mv_pos ) = abap_true.
      IF is_space( byte_at( mv_pos ) ) = abap_false.
        EXIT.
      ENDIF.
      mv_pos = mv_pos + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD take_name.
    DATA lv_begin TYPE i.
    DATA lv_byte TYPE ty_byte.
    DATA lv_c TYPE c LENGTH 1.
    lv_begin = mv_pos.
    WHILE has( mv_pos ) = abap_true.
      lv_byte = byte_at( mv_pos ).
      IF lv_byte = c_space OR lv_byte = c_slash OR lv_byte = c_gt OR lv_byte = c_eq
          OR lv_byte = c_quest OR lv_byte = c_lf OR lv_byte = c_tab OR lv_byte = c_cr.
        EXIT.
      ENDIF.
      mv_pos = mv_pos + 1.
    ENDWHILE.
    IF lv_begin = mv_pos.
      fail( iv_reason = 'document not wellformed'
            iv_at     = mv_pos ).
    ENDIF.
    rv_name = piece( iv_begin  = lv_begin
                     iv_length = mv_pos - lv_begin ).
    lv_c = rv_name(1).
    IF ( lv_c >= '0' AND lv_c <= '9' ) OR lv_c = '.' OR lv_c = '-'.
      fail( iv_reason = 'invalid character after ''<'''
            iv_at     = mv_pos ).
    ENDIF.
  ENDMETHOD.

  METHOD get_nsuri_by_prefix.
    DATA ls_current TYPE ty_nsbinding.
    IF iv_prefix = 'xml'.
      rv_nsuri = 'http://www.w3.org/XML/1998/namespace'.
      RETURN.
    ENDIF.
    READ TABLE mt_current WITH TABLE KEY prefix = iv_prefix INTO ls_current.
    IF sy-subrc = 0.
      rv_nsuri = ls_current-nsuri.
    ENDIF.
  ENDMETHOD.

  METHOD restore.
    DATA ls_binding TYPE ty_binding.
    DATA ls_current TYPE ty_nsbinding.
    DATA lv_last TYPE i.
    lv_last = lines( mt_bindings ).
    WHILE lv_last > 0.
      READ TABLE mt_bindings INDEX lv_last INTO ls_binding.
      IF ls_binding-depth <> iv_depth.
        EXIT.
      ENDIF.
      DELETE mt_bindings INDEX lv_last.
      DELETE TABLE mt_current WITH TABLE KEY prefix = ls_binding-prefix.
      IF ls_binding-had_previous = abap_true.
        ls_current-prefix = ls_binding-prefix.
        ls_current-nsuri = ls_binding-previous.
        INSERT ls_current INTO TABLE mt_current.
      ENDIF.
      lv_last = lv_last - 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD close_element.
    DATA ls_element TYPE ty_element.
    DATA lv_depth TYPE i.
    lv_depth = lines( mt_elements ).
    READ TABLE mt_elements INDEX lv_depth INTO ls_element.
    rs_item-kind = c_close.
    rs_item-name = ls_element-local_name.
    rs_item-prefix = ls_element-prefix.
    rs_item-nsuri = ls_element-nsuri.
    DELETE mt_elements INDEX lv_depth.
    restore( lv_depth ).
    IF mt_elements IS INITIAL.
      mv_done = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD open_element.
* MV_POS is on the '<' of a start tag
    DATA lv_name TYPE string.
    DATA lv_attr_name TYPE string.
    DATA lv_attr_value TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_local TYPE string.
    DATA lv_attr_nsuri TYPE string.
    DATA lv_quote TYPE ty_byte.
    DATA lv_quotes TYPE xstring.
    DATA lv_begin TYPE i.
    DATA lv_found TYPE i.
    DATA lv_depth TYPE i.
    DATA lv_i TYPE i.
    DATA ls_element TYPE ty_element.
    DATA ls_binding TYPE ty_binding.
    DATA ls_current TYPE ty_nsbinding.
    DATA ls_attribute TYPE ty_attribute.
    DATA lt_names TYPE string_table.
    DATA lt_values TYPE string_table.
    FIELD-SYMBOLS <ls_parent> TYPE ty_element.

    mv_pos = mv_pos + 1.
    lv_name = take_name( ).
    lv_depth = lines( mt_elements ) + 1.
    DO.
      whitespace( ).
      IF has( mv_pos ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      IF starts( '2F3E' ) = abap_true. " />
        mv_pos = mv_pos + 2.
        mv_pending_close = abap_true.
        EXIT.
      ENDIF.
      IF byte_at( mv_pos ) = c_gt.
        mv_pos = mv_pos + 1.
        EXIT.
      ENDIF.
      lv_attr_name = take_name( ).
      whitespace( ).
      IF has( mv_pos ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      IF byte_at( mv_pos ) <> c_eq.
        fail( iv_reason = 'document not wellformed'
              iv_at     = mv_pos ).
      ENDIF.
      mv_pos = mv_pos + 1.
      whitespace( ).
      IF has( mv_pos ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      lv_quote = byte_at( mv_pos ).
      IF lv_quote <> c_dquote AND lv_quote <> c_squote.
        fail( iv_reason = 'opening ''"'' or '''''' expected'
              iv_at     = mv_pos ).
      ENDIF.
      mv_pos = mv_pos + 1.
      lv_begin = mv_pos.
      lv_quotes = lv_quote.
      lv_found = seek( iv_needle = lv_quotes
                       iv_off    = mv_pos ).
      IF lv_found < 0.
        lv_found = find_in( iv_byte = c_lt
                            iv_from = lv_begin
                            iv_to   = mv_base + xstrlen( mv_buf ) ).
        IF lv_found >= 0.
          fail( iv_reason = 'closing ''"'' expected'
                iv_at     = lv_found ).
        ENDIF.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_base + xstrlen( mv_buf ) ).
      ENDIF.
* a '<' in the value is an error at the start of the value, as a system
* reports it (<a x="ab<"/> at 6)
      IF find_in( iv_byte = c_lt
                  iv_from = lv_begin
                  iv_to   = lv_found ) >= 0.
        fail( iv_reason = 'closing ''"'' expected'
              iv_at     = lv_begin ).
      ENDIF.
      lv_attr_value = text_of( iv_begin = lv_begin
                               iv_end   = lv_found ).
      mv_pos = lv_found + 1.
      IF lv_attr_name = 'xmlns' OR ( strlen( lv_attr_name ) >= 6 AND lv_attr_name(6) = 'xmlns:' ).
        CLEAR ls_binding.
        ls_binding-depth = lv_depth.
        IF lv_attr_name <> 'xmlns'.
          ls_binding-prefix = lv_attr_name+6.
        ENDIF.
        ls_binding-nsuri = lv_attr_value.
        READ TABLE mt_current WITH TABLE KEY prefix = ls_binding-prefix INTO ls_current.
        IF sy-subrc = 0.
          ls_binding-had_previous = abap_true.
          ls_binding-previous = ls_current-nsuri.
          DELETE TABLE mt_current WITH TABLE KEY prefix = ls_binding-prefix.
        ENDIF.
        APPEND ls_binding TO mt_bindings.
        ls_current-prefix = ls_binding-prefix.
        ls_current-nsuri = ls_binding-nsuri.
        INSERT ls_current INTO TABLE mt_current.
      ELSE.
        APPEND lv_attr_name TO lt_names.
        APPEND lv_attr_value TO lt_values.
      ENDIF.
    ENDDO.

    CLEAR ls_element.
    ls_element-name = lv_name.
    SPLIT lv_name AT ':' INTO lv_prefix lv_local.
    IF lv_local IS INITIAL.
      lv_local = lv_name.
      CLEAR lv_prefix.
    ENDIF.
    ls_element-local_name = lv_local.
    ls_element-prefix = lv_prefix.
    ls_element-nsuri = get_nsuri_by_prefix( lv_prefix ).
    IF lv_prefix IS NOT INITIAL AND ls_element-nsuri IS INITIAL.
      fail( iv_reason = 'undeclared namespace prefix'
            iv_at     = mv_pos ).
    ENDIF.
    IF lv_depth > 1.
      lv_i = lv_depth - 1.
      READ TABLE mt_elements INDEX lv_i ASSIGNING <ls_parent>.
      <ls_parent>-has_child = abap_true.
      <ls_parent>-children = <ls_parent>-children + 1.
    ELSE.
      mv_root_children = mv_root_children + 1.
    ENDIF.
    APPEND ls_element TO mt_elements.

    LOOP AT lt_names INTO lv_attr_name.
      lv_i = sy-tabix.
      READ TABLE lt_values INDEX lv_i INTO lv_attr_value.
      SPLIT lv_attr_name AT ':' INTO lv_prefix lv_local.
      IF lv_local IS INITIAL.
        lv_local = lv_attr_name.
        CLEAR lv_prefix.
      ENDIF.
      CLEAR lv_attr_nsuri.
      IF lv_prefix IS NOT INITIAL.
        lv_attr_nsuri = get_nsuri_by_prefix( lv_prefix ).
        IF lv_attr_nsuri IS INITIAL.
          fail( iv_reason = 'undeclared namespace prefix'
                iv_at     = mv_pos ).
        ENDIF.
      ENDIF.
      CLEAR ls_attribute.
      ls_attribute-name = lv_local.
      ls_attribute-prefix = lv_prefix.
      ls_attribute-nsuri = lv_attr_nsuri.
      ls_attribute-value = lv_attr_value.
      APPEND ls_attribute TO rs_item-attrs.
    ENDLOOP.
    rs_item-kind = c_open.
    rs_item-name = ls_element-local_name.
    rs_item-prefix = ls_element-prefix.
    rs_item-nsuri = ls_element-nsuri.
  ENDMETHOD.

  METHOD xml_next.
* Character data between two tags is ONE value however it is written: text,
* CDATA sections, comments and processing instructions in between are
* merged (measured: <a>1<!-- c -->2</a> is "12", text then CDATA is one
* value). A run of white space only is dropped before a start tag and
* inside an element that has a child element.
    DATA lv_byte TYPE ty_byte.
    DATA lv_byte2 TYPE ty_byte.
    DATA lv_begin TYPE i.
    DATA lv_found TYPE i.
    DATA lv_close_at TYPE i.
    DATA lv_name TYPE string.
    DATA lv_text TYPE string.
    DATA lv_any TYPE abap_bool.
    DATA lv_spaces TYPE string.
    DATA lv_drop TYPE abap_bool.
    DATA ls_element TYPE ty_element.

    WHILE has( mv_pos ) = abap_true.
      compact( ).
      lv_byte = byte_at( mv_pos ).
      CLEAR lv_byte2.
      IF lv_byte = c_lt AND has( mv_pos + 1 ) = abap_true.
        lv_byte2 = byte_at( mv_pos + 1 ).
      ENDIF.

      IF lv_byte = c_lt AND lv_byte2 = c_quest.
        lv_found = seek( iv_needle = '3F3E' " ?>
                         iv_off    = mv_pos + 2 ).
        IF lv_found < 0.
          fail( iv_reason = '<EOF> reached'
                iv_at     = mv_base + xstrlen( mv_buf ) ).
        ENDIF.
        mv_pos = lv_found + 2.
        CONTINUE.
      ENDIF.

      IF lv_byte = c_lt AND lv_byte2 = c_bang.
        IF starts( '3C212D2D' ) = abap_true. " <!--
          lv_begin = mv_pos + 4.
* the first '--' ends the comment when it is '-->'; anywhere else it is an
* error at the start of the comment's text (measured: <a><!--x--y--> at 7)
          lv_found = seek( iv_needle = '2D2D'
                           iv_off    = lv_begin ).
          IF lv_found < 0.
            fail( iv_reason = '<EOF> reached'
                  iv_at     = mv_base + xstrlen( mv_buf ) ).
          ENDIF.
          mv_pos = lv_found.
          IF starts( '2D2D3E' ) = abap_false.
            fail( iv_reason = '-- in comment'
                  iv_at     = lv_begin ).
          ENDIF.
          mv_pos = mv_pos + 3.
          CONTINUE.
        ENDIF.
        IF starts( '3C215B43444154415B' ) = abap_true. " <![CDATA[
          lv_begin = mv_pos + 9.
          lv_found = seek( iv_needle = '5D5D3E' " ]]>
                           iv_off    = lv_begin ).
          IF lv_found < 0.
            fail( iv_reason = '<EOF> reached'
                  iv_at     = mv_base + xstrlen( mv_buf ) ).
          ENDIF.
          lv_text = lv_text && piece( iv_begin  = lv_begin
                                      iv_length = lv_found - lv_begin ).
          lv_any = abap_true.
          mv_pos = lv_found + 3.
          IF mt_elements IS INITIAL.
* outside the root element a CDATA section is a value of its own, as the
* ported parser reads it
            rs_item-kind = c_value.
            rs_item-value = lv_text.
            RETURN.
          ENDIF.
          CONTINUE.
        ENDIF.
        fail( iv_reason = '''<!--'' or ''<![CDATA['' expected'
              iv_at     = mv_pos ).
      ENDIF.

      IF lv_byte = c_lt.
* a tag ends the run of character data before it
        IF lv_any = abap_true AND mt_elements IS NOT INITIAL AND lv_text IS NOT INITIAL.
          lv_drop = abap_false.
          lv_spaces = ` ` && cl_abap_char_utilities=>horizontal_tab
            && cl_abap_char_utilities=>newline && cl_abap_char_utilities=>cr_lf(1).
          IF mv_keep_whitespace = abap_false AND lv_text CO lv_spaces.
            READ TABLE mt_elements INDEX lines( mt_elements ) INTO ls_element.
            IF lv_byte2 <> c_slash OR ls_element-has_child = abap_true.
              lv_drop = abap_true.
            ENDIF.
          ENDIF.
          IF lv_drop = abap_false.
            rs_item-kind = c_value.
            rs_item-value = lv_text.
            RETURN.
          ENDIF.
        ENDIF.
        CLEAR: lv_text, lv_any.

        IF lv_byte2 = c_slash.
          lv_close_at = mv_pos.
          mv_pos = mv_pos + 2.
          lv_name = take_name( ).
          whitespace( ).
          IF has( mv_pos ) = abap_false.
            fail( iv_reason = '<EOF> reached'
                  iv_at     = mv_pos ).
          ENDIF.
          IF byte_at( mv_pos ) <> c_gt.
            fail( iv_reason = 'document not wellformed'
                  iv_at     = mv_pos ).
          ENDIF.
          mv_pos = mv_pos + 1.
          IF mt_elements IS INITIAL.
            fail( iv_reason = 'document not wellformed'
                  iv_at     = lv_close_at ).
          ENDIF.
          READ TABLE mt_elements INDEX lines( mt_elements ) INTO ls_element.
          IF ls_element-name <> lv_name.
* a system reports the close tag where it starts (<a>e</b> at 4)
            fail( iv_reason = 'document not wellformed'
                  iv_at     = lv_close_at ).
          ENDIF.
          rs_item = close_element( ).
          RETURN.
        ENDIF.

        rs_item = open_element( ).
        RETURN.
      ENDIF.

* character data up to the next '<'
      lv_begin = mv_pos.
      lv_found = seek( iv_needle = '3C'
                       iv_off    = mv_pos ).
      IF lv_found < 0.
        mv_pos = mv_base + xstrlen( mv_buf ).
      ELSE.
        mv_pos = lv_found.
      ENDIF.
      IF mt_elements IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_found < 0.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      lv_text = lv_text && text_of( iv_begin = lv_begin
                                    iv_end   = mv_pos ).
      lv_any = abap_true.
    ENDWHILE.

    IF mt_elements IS NOT INITIAL.
      fail( iv_reason = '<EOF> reached'
            iv_at     = mv_pos ).
    ENDIF.
    IF mv_pos = 0.
      fail( iv_reason = 'BOM / charset detection failed'
            iv_at     = 0 ).
    ENDIF.
    mv_done = abap_true.
    rs_item-kind = c_final.
  ENDMETHOD.

  METHOD next.
    IF mv_started = abap_false.
      start( ).
    ENDIF.
    IF mt_queue IS NOT INITIAL.
      READ TABLE mt_queue INDEX 1 INTO rs_item.
      DELETE mt_queue INDEX 1.
      RETURN.
    ENDIF.
    IF mv_done = abap_true.
      rs_item-kind = c_final.
      RETURN.
    ENDIF.
    IF mv_pending_close = abap_true.
      mv_pending_close = abap_false.
      rs_item = close_element( ).
      RETURN.
    ENDIF.
    IF mv_json = abap_true.
      rs_item = json_next( ).
    ELSE.
      rs_item = xml_next( ).
    ENDIF.
  ENDMETHOD.


  METHOD json_next.
* JSON as JSON-XML: object, array, str, num, bool, null; a member's key is
* the attribute "name" of the element of its value
    DATA lv_byte TYPE ty_byte.
    DATA lv_key TYPE string.
    DATA lv_last TYPE i.
    FIELD-SYMBOLS <ls_frame> TYPE ty_frame.

    compact( ).
    whitespace( ).
    IF mt_frames IS INITIAL.
      IF mv_json_top = abap_true.
        IF has( mv_pos ) = abap_true.
          fail( iv_reason = 'document not wellformed'
                iv_at     = mv_pos ).
        ENDIF.
        mv_done = abap_true.
        rs_item-kind = c_final.
        RETURN.
      ENDIF.
      mv_json_top = abap_true.
      rs_item = json_value( iv_key     = ``
                            iv_has_key = abap_false ).
      RETURN.
    ENDIF.

    IF has( mv_pos ) = abap_false.
      fail( iv_reason = '<EOF> reached'
            iv_at     = mv_pos ).
    ENDIF.
    lv_byte = byte_at( mv_pos ).
    lv_last = lines( mt_frames ).
    READ TABLE mt_frames INDEX lv_last ASSIGNING <ls_frame>.

    IF <ls_frame>-kind = 'A'.
      IF lv_byte = c_rbracket AND <ls_frame>-state <> 'V'.
        mv_pos = mv_pos + 1.
        rs_item = json_close( ).
        RETURN.
      ENDIF.
      IF <ls_frame>-state = 'A'.
        IF lv_byte <> c_comma.
          fail( iv_reason = 'document not wellformed'
                iv_at     = mv_pos ).
        ENDIF.
        mv_pos = mv_pos + 1.
        whitespace( ).
      ENDIF.
      <ls_frame>-state = 'A'.
      rs_item = json_value( iv_key     = ``
                            iv_has_key = abap_false ).
      RETURN.
    ENDIF.

    IF lv_byte = c_rbrace AND <ls_frame>-state = 'F'.
      mv_pos = mv_pos + 1.
      rs_item = json_close( ).
      RETURN.
    ENDIF.
    IF <ls_frame>-state = 'A'.
      IF lv_byte = c_rbrace.
        mv_pos = mv_pos + 1.
        rs_item = json_close( ).
        RETURN.
      ENDIF.
      IF lv_byte <> c_comma.
        fail( iv_reason = 'document not wellformed'
              iv_at     = mv_pos ).
      ENDIF.
      mv_pos = mv_pos + 1.
      whitespace( ).
      IF has( mv_pos ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      lv_byte = byte_at( mv_pos ).
    ENDIF.
    IF lv_byte <> c_dquote.
      fail( iv_reason = 'document not wellformed'
            iv_at     = mv_pos ).
    ENDIF.
    lv_key = json_string( ).
    whitespace( ).
    IF has( mv_pos ) = abap_false.
      fail( iv_reason = '<EOF> reached'
            iv_at     = mv_pos ).
    ENDIF.
    IF byte_at( mv_pos ) <> c_colon.
      fail( iv_reason = 'document not wellformed'
            iv_at     = mv_pos ).
    ENDIF.
    mv_pos = mv_pos + 1.
    whitespace( ).
    <ls_frame>-state = 'A'.
    rs_item = json_value( iv_key     = lv_key
                          iv_has_key = abap_true ).
  ENDMETHOD.

  METHOD json_close.
    DATA ls_frame TYPE ty_frame.
    DATA lv_last TYPE i.
    lv_last = lines( mt_frames ).
    READ TABLE mt_frames INDEX lv_last INTO ls_frame.
    DELETE mt_frames INDEX lv_last.
    rs_item-kind = c_close.
    IF ls_frame-kind = 'O'.
      rs_item-name = 'object'.
    ELSE.
      rs_item-name = 'array'.
    ENDIF.
  ENDMETHOD.

  METHOD json_value.
    DATA lv_byte TYPE ty_byte.
    DATA lv_begin TYPE i.
    DATA lv_value TYPE string.
    DATA lv_type TYPE string.
    DATA ls_frame TYPE ty_frame.
    DATA ls_queued TYPE ty_item.
    DATA ls_attribute TYPE ty_attribute.

    IF has( mv_pos ) = abap_false.
      fail( iv_reason = '<EOF> reached'
            iv_at     = mv_pos ).
    ENDIF.
    lv_byte = byte_at( mv_pos ).
    lv_begin = mv_pos.
    CASE lv_byte.
      WHEN c_lbrace.
        mv_pos = mv_pos + 1.
        ls_frame-kind = 'O'.
        ls_frame-state = 'F'.
        APPEND ls_frame TO mt_frames.
        lv_type = 'object'.
      WHEN c_lbracket.
        mv_pos = mv_pos + 1.
        ls_frame-kind = 'A'.
        ls_frame-state = 'F'.
        APPEND ls_frame TO mt_frames.
        lv_type = 'array'.
      WHEN c_dquote.
        lv_value = json_string( ).
        lv_type = 'str'.
      WHEN OTHERS.
        IF starts( '74727565' ) = abap_true. " true
          mv_pos = mv_pos + 4.
          lv_type = 'bool'.
          lv_value = 'true'.
        ELSEIF starts( '66616C7365' ) = abap_true. " false
          mv_pos = mv_pos + 5.
          lv_type = 'bool'.
          lv_value = 'false'.
        ELSEIF starts( '6E756C6C' ) = abap_true. " null
          mv_pos = mv_pos + 4.
          lv_type = 'null'.
        ELSE.
          WHILE has( mv_pos ) = abap_true.
            lv_byte = byte_at( mv_pos ).
            IF lv_byte = '2D' OR lv_byte = '2B' OR lv_byte = '2E' OR lv_byte = '45' OR lv_byte = '65'
                OR ( lv_byte >= '30' AND lv_byte <= '39' ).
              mv_pos = mv_pos + 1.
            ELSE.
              EXIT.
            ENDIF.
          ENDWHILE.
          IF mv_pos = lv_begin.
            fail( iv_reason = 'document not wellformed'
                  iv_at     = mv_pos ).
          ENDIF.
          lv_value = piece( iv_begin  = lv_begin
                            iv_length = mv_pos - lv_begin ).
          lv_type = 'num'.
        ENDIF.
    ENDCASE.

    rs_item-kind = c_open.
    rs_item-name = lv_type.
    IF iv_has_key = abap_true.
      ls_attribute-name = 'name'.
      ls_attribute-value = iv_key.
      APPEND ls_attribute TO rs_item-attrs.
    ENDIF.
    IF lv_type = 'object' OR lv_type = 'array'.
      RETURN.
    ENDIF.
    IF lv_type <> 'null'.
      CLEAR ls_queued.
      ls_queued-kind = c_value.
      ls_queued-value = lv_value.
      APPEND ls_queued TO mt_queue.
    ENDIF.
    CLEAR ls_queued.
    ls_queued-kind = c_close.
    ls_queued-name = lv_type.
    APPEND ls_queued TO mt_queue.
  ENDMETHOD.

  METHOD json_string.
* MV_POS is on the opening quote
    DATA lv_begin TYPE i.
    DATA lv_byte TYPE ty_byte.
    DATA lv_hex TYPE string.
    DATA lv_x TYPE x LENGTH 2.
    DATA lv_code TYPE i.
    mv_pos = mv_pos + 1.
    lv_begin = mv_pos.
    DO.
      IF has( mv_pos ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos ).
      ENDIF.
      lv_byte = byte_at( mv_pos ).
      IF lv_byte = c_dquote.
        rv_text = rv_text && piece( iv_begin  = lv_begin
                                    iv_length = mv_pos - lv_begin ).
        mv_pos = mv_pos + 1.
        RETURN.
      ENDIF.
      IF lv_byte <> c_backslash.
        mv_pos = mv_pos + 1.
        CONTINUE.
      ENDIF.
      rv_text = rv_text && piece( iv_begin  = lv_begin
                                  iv_length = mv_pos - lv_begin ).
      IF has( mv_pos + 1 ) = abap_false.
        fail( iv_reason = '<EOF> reached'
              iv_at     = mv_pos + 1 ).
      ENDIF.
      lv_byte = byte_at( mv_pos + 1 ).
      CASE lv_byte.
        WHEN '22' OR '5C' OR '2F'.
          lv_code = lv_byte.
          rv_text = rv_text && code_unit( lv_code ).
        WHEN '62'.
          rv_text = rv_text && code_unit( 8 ).
        WHEN '66'.
          rv_text = rv_text && code_unit( 12 ).
        WHEN '6E'.
          rv_text = rv_text && code_unit( 10 ).
        WHEN '72'.
          rv_text = rv_text && code_unit( 13 ).
        WHEN '74'.
          rv_text = rv_text && code_unit( 9 ).
        WHEN '75'.
          IF has( mv_pos + 5 ) = abap_false.
            fail( iv_reason = '<EOF> reached'
                  iv_at     = mv_base + xstrlen( mv_buf ) ).
          ENDIF.
          TRY.
              lv_hex = cl_abap_codepage=>convert_from( bytes( iv_begin  = mv_pos + 2
                                                              iv_length = 4 ) ).
              TRANSLATE lv_hex TO UPPER CASE.
              IF lv_hex CN '0123456789ABCDEF'.
                fail( iv_reason = 'document not wellformed'
                      iv_at     = mv_pos ).
              ENDIF.
              lv_x = lv_hex.
            CATCH cx_sy_conversion_codepage.
              fail( iv_reason = 'document not wellformed'
                    iv_at     = mv_pos ).
          ENDTRY.
          lv_code = lv_x.
          rv_text = rv_text && code_unit( lv_code ).
          mv_pos = mv_pos + 4.
        WHEN OTHERS.
          fail( iv_reason = 'document not wellformed'
                iv_at     = mv_pos ).
      ENDCASE.
      mv_pos = mv_pos + 2.
      lv_begin = mv_pos.
    ENDDO.
  ENDMETHOD.


  METHOD set_keep_whitespace.
    mv_keep_whitespace = iv_keep.
  ENDMETHOD.

  METHOD get_byte_offset.
    rv_offset = mv_pos.
  ENDMETHOD.

  METHOD get_nsbindings.
    rt_nsbindings = mt_current.
  ENDMETHOD.

  METHOD get_prefix_by_nsuri.
    DATA ls_current TYPE ty_nsbinding.
    LOOP AT mt_current INTO ls_current WHERE nsuri = iv_nsuri.
      rv_prefix = ls_current-prefix.
      RETURN.
    ENDLOOP.
  ENDMETHOD.

  METHOD get_path.
    DATA ls_element TYPE ty_element.
    DATA ls_node TYPE ty_pathnode.
    DATA lv_position TYPE i.
    lv_position = mv_root_children.
    LOOP AT mt_elements INTO ls_element.
      CLEAR ls_node.
      ls_node-name = ls_element-local_name.
      ls_node-nsuri = ls_element-nsuri.
      ls_node-prefix = ls_element-prefix.
      ls_node-child_position = lv_position.
      APPEND ls_node TO rt_path.
      lv_position = ls_element-children.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
