"! Raw DEFLATE (RFC 1951) decoded in pieces: FEED takes the next bytes of the
"! compressed stream and returns the bytes they complete, FINISH says whether
"! the stream really ended. This is what a zip entry holds and what
"! CL_ABAP_GZIP=>COMPRESS_BINARY writes.
"!
"! The decoder is a state machine whose steps are atomic: a block header, the
"! code tables of a dynamic block, one literal or one length/distance pair.
"! A step that runs out of input is rolled back and taken again on the next
"! FEED, so a piece may end anywhere, even inside a Huffman code. The last
"! 32 KiB of output are kept for back-references.
"!
"! Unlike CL_ABAP_UNGZIP_BINARY_STREAM (measured on a 7.5x system: a stream
"! cut short ends without an exception), an incomplete stream is an error at
"! FINISH, and a corrupt one at the FEED that reaches it.
"!
"! The canonical Huffman decoding follows RFC 1951 and zlib's puff.c; the
"! table layout is the one abapGit's ZCL_ABAPGIT_ZLIB uses (MIT).
CLASS zcl_osd_inflate DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS class_constructor.
    "! The whole stream at once
    CLASS-METHODS inflate
      IMPORTING iv_data       TYPE xstring
      RETURNING VALUE(rv_raw) TYPE xstring
      RAISING   zcx_osd_inflate.
    "! The next piece of the compressed stream; returns the output it completes
    METHODS feed
      IMPORTING iv_data       TYPE xstring
      RETURNING VALUE(rv_raw) TYPE xstring
      RAISING   zcx_osd_inflate.
    "! Raises unless the final block has ended
    METHODS finish
      RAISING zcx_osd_inflate.
    METHODS is_done
      RETURNING VALUE(rv_done) TYPE abap_bool.
    "! The bytes fed after the end of the stream (a gzip trailer, the next entry)
    METHODS get_unused
      RETURNING VALUE(rv_rest) TYPE xstring.

  PRIVATE SECTION.
    TYPES ty_ints TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    TYPES:
      BEGIN OF ty_huff,
        count  TYPE ty_ints,
        symbol TYPE ty_ints,
      END OF ty_huff.

    CONSTANTS:
      c_header     TYPE i VALUE 0,
      c_stored_len TYPE i VALUE 1,
      c_stored     TYPE i VALUE 2,
      c_table      TYPE i VALUE 3,
      c_symbols    TYPE i VALUE 4,
      c_done       TYPE i VALUE 5,
      c_window     TYPE i VALUE 32768.

    CLASS-DATA:
      gt_pow2       TYPE ty_ints,
      gt_len_base   TYPE ty_ints,
      gt_len_extra  TYPE ty_ints,
      gt_dist_base  TYPE ty_ints,
      gt_dist_extra TYPE ty_ints,
      gt_order      TYPE ty_ints,
      gs_fixed_len  TYPE ty_huff,
      gs_fixed_dist TYPE ty_huff.

    DATA:
      mv_in          TYPE xstring,
      mv_inlen       TYPE i,
      mv_pos         TYPE i,
      mv_bitbuf      TYPE i,
      mv_bitcnt      TYPE i,
      mv_state       TYPE i VALUE c_header,
      mv_final       TYPE abap_bool,
      mv_stored_left TYPE i,
      mv_hist        TYPE xstring,
      mv_unused      TYPE xstring,
      ms_len         TYPE ty_huff,
      ms_dist        TYPE ty_huff.

    CLASS-METHODS ints
      IMPORTING iv_list        TYPE string
      RETURNING VALUE(rt_ints) TYPE ty_ints.
    "! EV_LEFT is the unused code space: 0 for a complete code
    CLASS-METHODS build
      IMPORTING it_lengths TYPE ty_ints
      EXPORTING es_huff    TYPE ty_huff
                ev_left    TYPE i
      RAISING   zcx_osd_inflate.
    "! Exactly one symbol, with a code of length 1
    CLASS-METHODS single
      IMPORTING it_lengths   TYPE ty_ints
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    METHODS need
      IMPORTING iv_bits      TYPE i
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    METHODS bits
      IMPORTING iv_bits       TYPE i
      RETURNING VALUE(rv_val) TYPE i.
    METHODS decode
      IMPORTING is_huff          TYPE ty_huff
      RETURNING VALUE(rv_symbol) TYPE i
      RAISING   zcx_osd_inflate.
    METHODS step_header
      RETURNING VALUE(rv_ok) TYPE abap_bool
      RAISING   zcx_osd_inflate.
    METHODS step_stored_len
      RETURNING VALUE(rv_ok) TYPE abap_bool
      RAISING   zcx_osd_inflate.
    METHODS step_stored
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    METHODS step_table
      RETURNING VALUE(rv_ok) TYPE abap_bool
      RAISING   zcx_osd_inflate.
    METHODS step_symbol
      RETURNING VALUE(rv_ok) TYPE abap_bool
      RAISING   zcx_osd_inflate.
    METHODS end_block.
    METHODS copy
      IMPORTING iv_length   TYPE i
                iv_distance TYPE i
      RAISING   zcx_osd_inflate.
    METHODS fail
      IMPORTING iv_reason TYPE string
      RAISING   zcx_osd_inflate.
ENDCLASS.


CLASS zcl_osd_inflate IMPLEMENTATION.

  METHOD class_constructor.
    DATA lv_p TYPE i VALUE 1.
    DATA lt_lengths TYPE ty_ints.

    DO 25 TIMES.
      APPEND lv_p TO gt_pow2.
      lv_p = lv_p * 2.
    ENDDO.
    gt_len_base = ints( `3 4 5 6 7 8 9 10 11 13 15 17 19 23 27 31 35 43 51 59 67 83 99 115 131 163 195 227 258` ).
    gt_len_extra = ints( `0 0 0 0 0 0 0 0 1 1 1 1 2 2 2 2 3 3 3 3 4 4 4 4 5 5 5 5 0` ).
    gt_dist_base = ints( `1 2 3 4 5 7 9 13 17 25 33 49 65 97 129 193 257 385 513 769 1025 1537 2049 3073 4097 6145 8193 12289 16385 24577` ).
    gt_dist_extra = ints( `0 0 0 0 1 1 2 2 3 3 4 4 5 5 6 6 7 7 8 8 9 9 10 10 11 11 12 12 13 13` ).
    gt_order = ints( `16 17 18 0 8 7 9 6 10 5 11 4 12 3 13 2 14 1 15` ).

    DO 144 TIMES.
      APPEND 8 TO lt_lengths.
    ENDDO.
    DO 112 TIMES.
      APPEND 9 TO lt_lengths.
    ENDDO.
    DO 24 TIMES.
      APPEND 7 TO lt_lengths.
    ENDDO.
    DO 8 TIMES.
      APPEND 8 TO lt_lengths.
    ENDDO.
    TRY.
        build( EXPORTING it_lengths = lt_lengths IMPORTING es_huff = gs_fixed_len ).
        CLEAR lt_lengths.
        DO 30 TIMES.
          APPEND 5 TO lt_lengths.
        ENDDO.
        build( EXPORTING it_lengths = lt_lengths IMPORTING es_huff = gs_fixed_dist ).
      CATCH zcx_osd_inflate.
        ASSERT 1 = 0.
    ENDTRY.
  ENDMETHOD.

  METHOD ints.
    DATA lt_parts TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_part TYPE string.
    DATA lv_int TYPE i.
    SPLIT iv_list AT space INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      lv_int = lv_part.
      APPEND lv_int TO rt_ints.
    ENDLOOP.
  ENDMETHOD.

  METHOD build.
    DATA lt_offs TYPE ty_ints.
    DATA lv_len TYPE i.
    DATA lv_left TYPE i VALUE 1.
    DATA lv_count TYPE i.
    DATA lv_off TYPE i.
    DATA lv_symbol TYPE i.
    FIELD-SYMBOLS <lv_count> TYPE i.
    FIELD-SYMBOLS <lv_off> TYPE i.
    FIELD-SYMBOLS <lv_symbol> TYPE i.

    CLEAR es_huff.

    DO 15 TIMES.
      APPEND 0 TO es_huff-count.
    ENDDO.
    LOOP AT it_lengths INTO lv_len.
      IF lv_len > 0.
        READ TABLE es_huff-count INDEX lv_len ASSIGNING <lv_count>.
        <lv_count> = <lv_count> + 1.
      ENDIF.
    ENDLOOP.
    LOOP AT es_huff-count INTO lv_count.
      lv_left = lv_left * 2 - lv_count.
      IF lv_left < 0.
        RAISE EXCEPTION TYPE zcx_osd_inflate EXPORTING iv_reason = `over-subscribed Huffman code lengths`.
      ENDIF.
    ENDLOOP.
    ev_left = lv_left.

    LOOP AT es_huff-count INTO lv_count.
      APPEND lv_off TO lt_offs.
      lv_off = lv_off + lv_count.
    ENDLOOP.
    DO lines( it_lengths ) TIMES.
      APPEND 0 TO es_huff-symbol.
    ENDDO.
    LOOP AT it_lengths INTO lv_len.
      lv_symbol = sy-tabix - 1.
      IF lv_len > 0.
        READ TABLE lt_offs INDEX lv_len ASSIGNING <lv_off>.
        READ TABLE es_huff-symbol INDEX <lv_off> + 1 ASSIGNING <lv_symbol>.
        <lv_symbol> = lv_symbol.
        <lv_off> = <lv_off> + 1.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD single.
    DATA lv_len TYPE i.
    DATA lv_used TYPE i.
    LOOP AT it_lengths INTO lv_len WHERE table_line > 0.
      IF lv_len <> 1.
        RETURN.
      ENDIF.
      lv_used = lv_used + 1.
    ENDLOOP.
    rv_ok = boolc( lv_used = 1 ).
  ENDMETHOD.

  METHOD inflate.
    DATA lo_inflate TYPE REF TO zcl_osd_inflate.
    CREATE OBJECT lo_inflate.
    rv_raw = lo_inflate->feed( iv_data ).
    lo_inflate->finish( ).
  ENDMETHOD.

  METHOD feed.
    DATA lv_from TYPE i.
    DATA lv_len TYPE i.
    DATA lv_cut TYPE i.
    DATA lv_ok TYPE abap_bool.
    DATA lv_pos TYPE i.
    DATA lv_bitbuf TYPE i.
    DATA lv_bitcnt TYPE i.
    DATA lv_piece TYPE xstring.
    DATA lt_out TYPE STANDARD TABLE OF xstring WITH DEFAULT KEY.

    IF mv_state = c_done.
      CONCATENATE mv_unused iv_data INTO mv_unused IN BYTE MODE.
      RETURN.
    ENDIF.

    IF mv_pos > 0.
      mv_in = mv_in+mv_pos.
      mv_pos = 0.
    ENDIF.
    CONCATENATE mv_in iv_data INTO mv_in IN BYTE MODE.
    mv_inlen = xstrlen( mv_in ).
    lv_from = xstrlen( mv_hist ).

    DO.
      IF mv_state = c_done.
        EXIT.
      ENDIF.
      lv_pos = mv_pos.
      lv_bitbuf = mv_bitbuf.
      lv_bitcnt = mv_bitcnt.
      CASE mv_state.
        WHEN c_header.
          lv_ok = step_header( ).
        WHEN c_stored_len.
          lv_ok = step_stored_len( ).
        WHEN c_stored.
          lv_ok = step_stored( ).
        WHEN c_table.
          lv_ok = step_table( ).
        WHEN OTHERS.
          lv_ok = step_symbol( ).
      ENDCASE.
      IF lv_ok = abap_false.
        mv_pos = lv_pos.
        mv_bitbuf = lv_bitbuf.
        mv_bitcnt = lv_bitcnt.
        EXIT.
      ENDIF.
      " the history stays between 32 and 64 KiB: what falls out of the window
      " goes to the output first, so no copy ever slices a long history
      lv_len = xstrlen( mv_hist ).
      IF lv_len > 2 * c_window.
        lv_cut = lv_len - c_window.
        IF lv_from < lv_cut.
          lv_len = lv_cut - lv_from.
          lv_piece = mv_hist+lv_from(lv_len).
          APPEND lv_piece TO lt_out.
          lv_from = lv_cut.
        ENDIF.
        mv_hist = mv_hist+lv_cut.
        lv_from = lv_from - lv_cut.
      ENDIF.
    ENDDO.

    lv_piece = mv_hist+lv_from.
    APPEND lv_piece TO lt_out.
    LOOP AT lt_out INTO lv_piece.
      CONCATENATE rv_raw lv_piece INTO rv_raw IN BYTE MODE.
    ENDLOOP.
  ENDMETHOD.

  METHOD finish.
    IF mv_state <> c_done.
      fail( `the deflate stream ends before its final block` ).
    ENDIF.
  ENDMETHOD.

  METHOD is_done.
    rv_done = boolc( mv_state = c_done ).
  ENDMETHOD.

  METHOD get_unused.
    rv_rest = mv_unused.
  ENDMETHOD.

  METHOD fail.
    RAISE EXCEPTION TYPE zcx_osd_inflate EXPORTING iv_reason = iv_reason.
  ENDMETHOD.

  METHOD need.
    DATA lv_x TYPE x LENGTH 1.
    DATA lv_byte TYPE i.
    DATA lv_p TYPE i.
    WHILE mv_bitcnt < iv_bits.
      IF mv_pos >= mv_inlen.
        rv_ok = abap_false.
        RETURN.
      ENDIF.
      lv_x = mv_in+mv_pos(1).
      lv_byte = lv_x.
      READ TABLE gt_pow2 INDEX mv_bitcnt + 1 INTO lv_p.
      mv_bitbuf = mv_bitbuf + lv_byte * lv_p.
      mv_bitcnt = mv_bitcnt + 8.
      mv_pos = mv_pos + 1.
    ENDWHILE.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD bits.
    DATA lv_p TYPE i.
    READ TABLE gt_pow2 INDEX iv_bits + 1 INTO lv_p.
    rv_val = mv_bitbuf MOD lv_p.
    mv_bitbuf = mv_bitbuf DIV lv_p.
    mv_bitcnt = mv_bitcnt - iv_bits.
  ENDMETHOD.

  METHOD decode.
    DATA lv_code TYPE i.
    DATA lv_first TYPE i.
    DATA lv_index TYPE i.
    DATA lv_count TYPE i.
    DATA lv_len TYPE i VALUE 1.

    WHILE lv_len <= 15.
      IF mv_bitcnt < 1 AND need( 1 ) = abap_false.
        rv_symbol = -1.
        RETURN.
      ENDIF.
      lv_code = lv_code + mv_bitbuf MOD 2.
      mv_bitbuf = mv_bitbuf DIV 2.
      mv_bitcnt = mv_bitcnt - 1.
      READ TABLE is_huff-count INDEX lv_len INTO lv_count.
      IF lv_code - lv_count < lv_first.
        READ TABLE is_huff-symbol INDEX lv_index + lv_code - lv_first + 1 INTO rv_symbol.
        RETURN.
      ENDIF.
      lv_index = lv_index + lv_count.
      lv_first = ( lv_first + lv_count ) * 2.
      lv_code = lv_code * 2.
      lv_len = lv_len + 1.
    ENDWHILE.
    fail( `invalid Huffman code` ).
  ENDMETHOD.

  METHOD step_header.
    DATA lv_type TYPE i.
    IF need( 3 ) = abap_false.
      RETURN.
    ENDIF.
    mv_final = boolc( bits( 1 ) = 1 ).
    lv_type = bits( 2 ).
    CASE lv_type.
      WHEN 0.
        mv_state = c_stored_len.
      WHEN 1.
        ms_len = gs_fixed_len.
        ms_dist = gs_fixed_dist.
        mv_state = c_symbols.
      WHEN 2.
        mv_state = c_table.
      WHEN OTHERS.
        fail( `invalid block type 3` ).
    ENDCASE.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD step_stored_len.
    DATA lv_len TYPE i.
    DATA lv_nlen TYPE i.
    lv_len = mv_bitcnt MOD 8.
    bits( lv_len ).
    IF need( 16 ) = abap_false.
      RETURN.
    ENDIF.
    lv_len = bits( 16 ).
    IF need( 16 ) = abap_false.
      RETURN.
    ENDIF.
    lv_nlen = bits( 16 ).
    IF lv_nlen <> 65535 - lv_len.
      fail( `stored block length does not match its complement` ).
    ENDIF.
    mv_stored_left = lv_len.
    mv_state = c_stored.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD step_stored.
    DATA lv_take TYPE i.
    DATA lv_bytes TYPE xstring.
    IF mv_stored_left = 0.
      end_block( ).
      rv_ok = abap_true.
      RETURN.
    ENDIF.
    lv_take = mv_inlen - mv_pos.
    IF lv_take > mv_stored_left.
      lv_take = mv_stored_left.
    ENDIF.
    IF lv_take = 0.
      RETURN.
    ENDIF.
    lv_bytes = mv_in+mv_pos(lv_take).
    CONCATENATE mv_hist lv_bytes INTO mv_hist IN BYTE MODE.
    mv_pos = mv_pos + lv_take.
    mv_stored_left = mv_stored_left - lv_take.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD step_table.
    DATA lv_nlen TYPE i.
    DATA lv_ndist TYPE i.
    DATA lv_ncode TYPE i.
    DATA lv_index TYPE i.
    DATA lv_symbol TYPE i.
    DATA lv_repeat TYPE i.
    DATA lv_prev TYPE i.
    DATA lt_codes TYPE ty_ints.
    DATA lt_lengths TYPE ty_ints.
    DATA lt_dists TYPE ty_ints.
    DATA ls_codes TYPE ty_huff.
    DATA lv_left TYPE i.
    DATA lv_used TYPE i.
    DATA lv_nth TYPE i.
    FIELD-SYMBOLS <lv_len> TYPE i.

    IF need( 14 ) = abap_false.
      RETURN.
    ENDIF.
    lv_nlen = bits( 5 ) + 257.
    lv_ndist = bits( 5 ) + 1.
    lv_ncode = bits( 4 ) + 4.
    IF lv_nlen > 286 OR lv_ndist > 30.
      fail( `too many length or distance codes` ).
    ENDIF.

    DO 19 TIMES.
      APPEND 0 TO lt_codes.
    ENDDO.
    DO lv_ncode TIMES.
      lv_nth = sy-index.
      IF need( 3 ) = abap_false.
        RETURN.
      ENDIF.
      READ TABLE gt_order INDEX lv_nth INTO lv_index.
      READ TABLE lt_codes INDEX lv_index + 1 ASSIGNING <lv_len>.
      <lv_len> = bits( 3 ).
    ENDDO.
    build( EXPORTING it_lengths = lt_codes IMPORTING es_huff = ls_codes ev_left = lv_left ).
    IF lv_left <> 0.
      fail( `incomplete code-length code` ).
    ENDIF.

    WHILE lines( lt_lengths ) < lv_nlen + lv_ndist.
      lv_symbol = decode( ls_codes ).
      IF lv_symbol < 0.
        RETURN.
      ENDIF.
      IF lv_symbol < 16.
        APPEND lv_symbol TO lt_lengths.
        CONTINUE.
      ENDIF.
      lv_prev = 0.
      IF lv_symbol = 16.
        IF lt_lengths IS INITIAL.
          fail( `repeat code with no previous length` ).
        ENDIF.
        READ TABLE lt_lengths INDEX lines( lt_lengths ) INTO lv_prev.
        IF need( 2 ) = abap_false.
          RETURN.
        ENDIF.
        lv_repeat = 3 + bits( 2 ).
      ELSEIF lv_symbol = 17.
        IF need( 3 ) = abap_false.
          RETURN.
        ENDIF.
        lv_repeat = 3 + bits( 3 ).
      ELSE.
        IF need( 7 ) = abap_false.
          RETURN.
        ENDIF.
        lv_repeat = 11 + bits( 7 ).
      ENDIF.
      IF lines( lt_lengths ) + lv_repeat > lv_nlen + lv_ndist.
        fail( `code lengths repeat past the end of the table` ).
      ENDIF.
      DO lv_repeat TIMES.
        APPEND lv_prev TO lt_lengths.
      ENDDO.
    ENDWHILE.

    READ TABLE lt_lengths INDEX 257 INTO lv_prev.
    IF lv_prev = 0.
      fail( `no code for the end of the block` ).
    ENDIF.
    lt_codes = lt_lengths.
    CLEAR lt_lengths.
    LOOP AT lt_codes INTO lv_prev.
      IF sy-tabix <= lv_nlen.
        APPEND lv_prev TO lt_lengths.
      ELSE.
        APPEND lv_prev TO lt_dists.
      ENDIF.
    ENDLOOP.
    " complete codes only, except one code of length 1 (zlib's inflate_table);
    " a distance code with no symbols at all is fine for a literal-only block
    build( EXPORTING it_lengths = lt_lengths IMPORTING es_huff = ms_len ev_left = lv_left ).
    IF lv_left <> 0 AND single( lt_lengths ) = abap_false.
      fail( `incomplete literal/length code` ).
    ENDIF.
    build( EXPORTING it_lengths = lt_dists IMPORTING es_huff = ms_dist ev_left = lv_left ).
    IF lv_left <> 0 AND single( lt_dists ) = abap_false.
      LOOP AT lt_dists INTO lv_prev WHERE table_line > 0.
        lv_used = lv_used + 1.
      ENDLOOP.
      IF lv_used > 0.
        fail( `incomplete distance code` ).
      ENDIF.
    ENDIF.
    mv_state = c_symbols.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD step_symbol.
    DATA lv_symbol TYPE i.
    DATA lv_x TYPE x LENGTH 1.
    DATA lv_extra TYPE i.
    DATA lv_length TYPE i.
    DATA lv_distance TYPE i.

    lv_symbol = decode( ms_len ).
    IF lv_symbol < 0.
      RETURN.
    ENDIF.
    IF lv_symbol < 256.
      lv_x = lv_symbol.
      CONCATENATE mv_hist lv_x INTO mv_hist IN BYTE MODE.
      rv_ok = abap_true.
      RETURN.
    ENDIF.
    IF lv_symbol = 256.
      end_block( ).
      rv_ok = abap_true.
      RETURN.
    ENDIF.

    lv_symbol = lv_symbol - 257.
    IF lv_symbol >= 29.
      fail( `invalid length symbol` ).
    ENDIF.
    READ TABLE gt_len_extra INDEX lv_symbol + 1 INTO lv_extra.
    IF need( lv_extra ) = abap_false.
      RETURN.
    ENDIF.
    READ TABLE gt_len_base INDEX lv_symbol + 1 INTO lv_length.
    lv_length = lv_length + bits( lv_extra ).

    lv_symbol = decode( ms_dist ).
    IF lv_symbol < 0.
      RETURN.
    ENDIF.
    IF lv_symbol >= 30.
      fail( `invalid distance symbol` ).
    ENDIF.
    READ TABLE gt_dist_extra INDEX lv_symbol + 1 INTO lv_extra.
    IF need( lv_extra ) = abap_false.
      RETURN.
    ENDIF.
    READ TABLE gt_dist_base INDEX lv_symbol + 1 INTO lv_distance.
    lv_distance = lv_distance + bits( lv_extra ).

    copy( iv_length = lv_length iv_distance = lv_distance ).
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD end_block.
    DATA lv_x TYPE x LENGTH 1.
    DATA lv_rest TYPE xstring.
    IF mv_final = abap_false.
      mv_state = c_header.
      RETURN.
    ENDIF.
    mv_state = c_done.
    " the whole bytes still in the bit buffer were read past the end
    bits( mv_bitcnt MOD 8 ).
    WHILE mv_bitcnt >= 8.
      lv_x = bits( 8 ).
      CONCATENATE mv_unused lv_x INTO mv_unused IN BYTE MODE.
    ENDWHILE.
    lv_rest = mv_in+mv_pos.
    CONCATENATE mv_unused lv_rest INTO mv_unused IN BYTE MODE.
    mv_pos = mv_inlen.
  ENDMETHOD.

  METHOD copy.
    DATA lv_have TYPE i.
    DATA lv_start TYPE i.
    DATA lv_left TYPE i.
    DATA lv_piece TYPE xstring.

    lv_have = xstrlen( mv_hist ).
    IF iv_distance > lv_have.
      fail( `invalid distance too far back` ).
    ENDIF.
    lv_start = lv_have - iv_distance.
    IF iv_distance >= iv_length.
      lv_piece = mv_hist+lv_start(iv_length).
      CONCATENATE mv_hist lv_piece INTO mv_hist IN BYTE MODE.
      RETURN.
    ENDIF.
    " overlapping: the copied bytes repeat with the period of the distance
    lv_piece = mv_hist+lv_start(iv_distance).
    lv_left = iv_length.
    WHILE lv_left >= iv_distance.
      CONCATENATE mv_hist lv_piece INTO mv_hist IN BYTE MODE.
      lv_left = lv_left - iv_distance.
    ENDWHILE.
    IF lv_left > 0.
      lv_piece = lv_piece(lv_left).
      CONCATENATE mv_hist lv_piece INTO mv_hist IN BYTE MODE.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
