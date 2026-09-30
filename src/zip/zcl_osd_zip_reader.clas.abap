"! A zip archive read in pieces. The central directory at the end of the
"! archive gives the entries; OPEN positions on one entry and READ returns
"! its content piece by piece, inflated by ZCL_OSD_INFLATE (method 8) or as
"! stored (method 0). When an entry's last piece has been read, its size and
"! its CRC-32 are checked against the directory, so a damaged or cut entry is
"! an exception rather than short content.
"!
"! The bytes come from a ZIF_OSD_ZIP_SOURCE: ZCL_OSD_ZIP_SOURCE_DATASET reads
"! a file with OPEN DATASET, ZCL_OSD_ZIP_SOURCE_X one in memory.
"!
"! Not read: ZIP64 (archives or entries of 2 GiB and more), encrypted
"! entries, split archives, methods other than stored and deflate. Names are
"! decoded as UTF-8 whether or not the entry sets the UTF-8 flag.
"!
"! Usage:
"!   CREATE OBJECT lo_zip EXPORTING io_source = lo_source.
"!   lo_zip->open( `data/big.xml` ).
"!   WHILE lo_zip->is_eof( ) = abap_false.
"!     lv_piece = lo_zip->read( ).
"!   ENDWHILE.
CLASS zcl_osd_zip_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_entry,
        name            TYPE string,
        method          TYPE i,
        crc32           TYPE zcl_osd_crc32=>ty_crc,
        compressed_size TYPE i,
        size            TYPE i,
        is_directory    TYPE abap_bool,
        is_encrypted    TYPE abap_bool,
        header_offset   TYPE i,
      END OF ty_entry.
    TYPES tt_entry TYPE STANDARD TABLE OF ty_entry WITH DEFAULT KEY.

    METHODS constructor
      IMPORTING io_source TYPE REF TO zif_osd_zip_source
      RAISING   zcx_osd_zip.
    "! The entries in the order of the central directory
    METHODS get_entries
      RETURNING VALUE(rt_entries) TYPE tt_entry.
    METHODS get_comment
      RETURNING VALUE(rv_comment) TYPE string.
    METHODS open
      IMPORTING iv_name TYPE string
      RAISING   zcx_osd_zip.
    "! The next piece of the open entry. Memory per call is bounded by both
    "! limits: IV_MAX bytes of compressed input read, IV_MAX_OUT bytes of
    "! output returned (about: a deflate match may add up to 258). A piece may
    "! be empty before the end; loop until IS_EOF.
    METHODS read
      IMPORTING iv_max         TYPE i DEFAULT 65536
                iv_max_out     TYPE i DEFAULT 1048576
      RETURNING VALUE(rv_data) TYPE xstring
      RAISING   zcx_osd_zip.
    METHODS is_eof
      RETURNING VALUE(rv_eof) TYPE abap_bool.
    "! One entry whole, for small entries
    METHODS read_all
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_data) TYPE xstring
      RAISING   zcx_osd_zip.

  PRIVATE SECTION.
    DATA mo_source TYPE REF TO zif_osd_zip_source.
    DATA mt_entries TYPE tt_entry.
    DATA mv_comment TYPE string.
    DATA ms_entry TYPE ty_entry.
    DATA mv_open TYPE abap_bool.
    DATA mv_eof TYPE abap_bool VALUE abap_true.
    DATA mv_pos TYPE i.
    DATA mv_left TYPE i.
    DATA mv_produced TYPE i.
    DATA mo_inflate TYPE REF TO zcl_osd_inflate.
    DATA mo_crc TYPE REF TO zcl_osd_crc32.

    CLASS-METHODS le
      IMPORTING iv_data         TYPE xstring
                iv_off          TYPE i
                iv_len          TYPE i
      RETURNING VALUE(rv_value) TYPE i
      RAISING   zcx_osd_zip.
    CLASS-METHODS text
      IMPORTING iv_data        TYPE xstring
      RETURNING VALUE(rv_text) TYPE string.
    METHODS read_directory
      RAISING zcx_osd_zip.
    METHODS finish_entry
      RAISING zcx_osd_zip.
    METHODS fail
      IMPORTING iv_reason TYPE string
      RAISING   zcx_osd_zip.
ENDCLASS.


CLASS zcl_osd_zip_reader IMPLEMENTATION.

  METHOD constructor.
    mo_source = io_source.
    read_directory( ).
  ENDMETHOD.

  METHOD fail.
    RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = iv_reason.
  ENDMETHOD.

  METHOD le.
    " little-endian unsigned; a 4-byte field of 2 GiB and more (ZIP64's
    " FFFFFFFF among them) does not fit and is refused
    DATA lv_byte TYPE x LENGTH 1.
    DATA lv_int TYPE i.
    DATA lv_mult TYPE i VALUE 1.
    DATA lv_at TYPE i.
    IF iv_off + iv_len > xstrlen( iv_data ).
      RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = `a record runs past the end of the archive`.
    ENDIF.
    DO iv_len TIMES.
      lv_at = iv_off + sy-index - 1.
      lv_byte = iv_data+lv_at(1).
      lv_int = lv_byte.
      IF sy-index = 4 AND lv_int >= 128.
        RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = `a size or offset of 2 GiB or more (ZIP64 is not read)`.
      ENDIF.
      rv_value = rv_value + lv_int * lv_mult.
      IF sy-index < iv_len.
        lv_mult = lv_mult * 256.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD text.
    TRY.
        rv_text = cl_abap_codepage=>convert_from( iv_data ).
      CATCH cx_root.
        rv_text = ''.
    ENDTRY.
  ENDMETHOD.

  METHOD read_directory.
    CONSTANTS lc_eocd TYPE x LENGTH 4 VALUE '504B0506'.
    CONSTANTS lc_central TYPE x LENGTH 4 VALUE '504B0102'.
    DATA lv_size TYPE i.
    DATA lv_tail_len TYPE i.
    DATA lv_tail TYPE xstring.
    DATA lv_at TYPE i.
    DATA lv_sig TYPE x LENGTH 4.
    DATA lv_found TYPE abap_bool.
    DATA lv_count TYPE i.
    DATA lv_cd_size TYPE i.
    DATA lv_cd_off TYPE i.
    DATA lv_len TYPE i.
    DATA lv_bytes TYPE xstring.
    DATA lv_cd TYPE xstring.
    DATA lv_flags TYPE i.
    DATA lv_nlen TYPE i.
    DATA lv_elen TYPE i.
    DATA lv_klen TYPE i.
    DATA lv_crc TYPE x LENGTH 4.
    DATA lv_last TYPE i.
    DATA ls_entry TYPE ty_entry.

    lv_size = mo_source->size( ).
    IF lv_size < 22.
      fail( `not a zip archive: shorter than an end of central directory record` ).
    ENDIF.
    " the end record is the last 22 bytes plus a comment of up to 65535
    lv_tail_len = lv_size.
    IF lv_tail_len > 65557.
      lv_tail_len = 65557.
    ENDIF.
    lv_tail = mo_source->read( iv_pos = lv_size - lv_tail_len iv_len = lv_tail_len ).
    " the record is taken only where its comment ends the archive exactly, so
    " a comment that happens to contain the signature is not the record
    lv_at = xstrlen( lv_tail ) - 22.
    WHILE lv_at >= 0.
      lv_sig = lv_tail+lv_at(4).
      IF lv_sig = lc_eocd AND lv_at + 22 + le( iv_data = lv_tail iv_off = lv_at + 20 iv_len = 2 ) = xstrlen( lv_tail ).
        lv_found = abap_true.
        EXIT.
      ENDIF.
      lv_at = lv_at - 1.
    ENDWHILE.
    IF lv_found = abap_false.
      fail( `not a zip archive: no end of central directory record` ).
    ENDIF.

    IF le( iv_data = lv_tail iv_off = lv_at + 4 iv_len = 2 ) <> 0
        OR le( iv_data = lv_tail iv_off = lv_at + 6 iv_len = 2 ) <> 0.
      fail( `split archives are not read` ).
    ENDIF.
    lv_count = le( iv_data = lv_tail iv_off = lv_at + 10 iv_len = 2 ).
    IF lv_count = 65535.
      fail( `ZIP64 archives are not read` ).
    ENDIF.
    lv_cd_size = le( iv_data = lv_tail iv_off = lv_at + 12 iv_len = 4 ).
    lv_cd_off = le( iv_data = lv_tail iv_off = lv_at + 16 iv_len = 4 ).
    lv_len = le( iv_data = lv_tail iv_off = lv_at + 20 iv_len = 2 ).
    IF lv_at + 22 + lv_len > xstrlen( lv_tail ).
      fail( `the archive comment runs past the end` ).
    ENDIF.
    lv_bytes = lv_tail+lv_at.
    lv_bytes = lv_bytes+22(lv_len).
    mv_comment = text( lv_bytes ).

    " compared without adding the two, which could overflow
    IF lv_cd_size > lv_size - xstrlen( lv_tail ) + lv_at OR lv_cd_off > lv_size - xstrlen( lv_tail ) + lv_at - lv_cd_size.
      fail( `the central directory lies outside the archive` ).
    ENDIF.
    lv_cd = mo_source->read( iv_pos = lv_cd_off iv_len = lv_cd_size ).
    lv_at = 0.
    DO lv_count TIMES.
      IF lv_at + 46 > xstrlen( lv_cd ).
        fail( `the central directory is shorter than its entry count` ).
      ENDIF.
      lv_sig = lv_cd+lv_at(4).
      IF lv_sig <> lc_central.
        fail( `a central directory entry has the wrong signature` ).
      ENDIF.
      CLEAR ls_entry.
      lv_flags = le( iv_data = lv_cd iv_off = lv_at + 8 iv_len = 2 ).
      ls_entry-is_encrypted = boolc( lv_flags MOD 2 = 1 ).
      ls_entry-method = le( iv_data = lv_cd iv_off = lv_at + 10 iv_len = 2 ).
      " stored little-endian; kept as the number, most significant byte first
      lv_last = lv_at + 16.
      lv_crc = lv_cd+lv_last(4).
      CONCATENATE lv_crc+3(1) lv_crc+2(1) lv_crc+1(1) lv_crc(1) INTO lv_bytes IN BYTE MODE.
      ls_entry-crc32 = lv_bytes.
      ls_entry-compressed_size = le( iv_data = lv_cd iv_off = lv_at + 20 iv_len = 4 ).
      ls_entry-size = le( iv_data = lv_cd iv_off = lv_at + 24 iv_len = 4 ).
      lv_nlen = le( iv_data = lv_cd iv_off = lv_at + 28 iv_len = 2 ).
      lv_elen = le( iv_data = lv_cd iv_off = lv_at + 30 iv_len = 2 ).
      lv_klen = le( iv_data = lv_cd iv_off = lv_at + 32 iv_len = 2 ).
      ls_entry-header_offset = le( iv_data = lv_cd iv_off = lv_at + 42 iv_len = 4 ).
      IF lv_at + 46 + lv_nlen > xstrlen( lv_cd ).
        fail( `an entry name runs past the central directory` ).
      ENDIF.
      lv_last = lv_at + 46.
      lv_bytes = lv_cd+lv_last(lv_nlen).
      ls_entry-name = text( lv_bytes ).
      lv_last = strlen( ls_entry-name ) - 1.
      IF lv_last >= 0 AND ls_entry-name+lv_last(1) = '/'.
        ls_entry-is_directory = abap_true.
      ENDIF.
      APPEND ls_entry TO mt_entries.
      lv_at = lv_at + 46 + lv_nlen + lv_elen + lv_klen.
    ENDDO.
  ENDMETHOD.

  METHOD get_entries.
    rt_entries = mt_entries.
  ENDMETHOD.

  METHOD get_comment.
    rv_comment = mv_comment.
  ENDMETHOD.

  METHOD open.
    CONSTANTS lc_local TYPE x LENGTH 4 VALUE '504B0304'.
    DATA lv_header TYPE xstring.
    DATA lv_sig TYPE x LENGTH 4.
    DATA lv_nlen TYPE i.
    DATA lv_elen TYPE i.

    READ TABLE mt_entries INTO ms_entry WITH KEY name = iv_name.
    IF sy-subrc <> 0.
      fail( |no entry { iv_name } in the archive| ).
    ENDIF.
    IF ms_entry-is_encrypted = abap_true.
      fail( |{ iv_name } is encrypted| ).
    ENDIF.
    IF ms_entry-method <> 0 AND ms_entry-method <> 8.
      fail( |{ iv_name } uses compression method { ms_entry-method }, only stored (0) and deflate (8) are read| ).
    ENDIF.
    lv_header = mo_source->read( iv_pos = ms_entry-header_offset iv_len = 30 ).
    IF xstrlen( lv_header ) < 30.
      fail( |the local header of { iv_name } runs past the end| ).
    ENDIF.
    lv_sig = lv_header(4).
    IF lv_sig <> lc_local.
      fail( |the local header of { iv_name } has the wrong signature| ).
    ENDIF.
    lv_nlen = le( iv_data = lv_header iv_off = 26 iv_len = 2 ).
    lv_elen = le( iv_data = lv_header iv_off = 28 iv_len = 2 ).

    mv_pos = ms_entry-header_offset + 30 + lv_nlen + lv_elen.
    mv_left = ms_entry-compressed_size.
    mv_produced = 0.
    mv_open = abap_true.
    mv_eof = abap_false.
    CREATE OBJECT mo_crc.
    IF ms_entry-method = 8.
      CREATE OBJECT mo_inflate.
    ELSE.
      CLEAR mo_inflate.
    ENDIF.
  ENDMETHOD.

  METHOD read.
    DATA lv_take TYPE i.
    DATA lv_data TYPE xstring.
    DATA lv_paused TYPE abap_bool.
    DATA lx_inflate TYPE REF TO zcx_osd_inflate.

    IF mv_open = abap_false.
      fail( `no entry is open` ).
    ENDIF.
    IF mv_eof = abap_true.
      RETURN.
    ENDIF.
    IF mo_inflate IS BOUND.
      lv_paused = mo_inflate->is_paused( ).
    ENDIF.
    " while output is still waiting in what was read, nothing more is read
    IF lv_paused = abap_false.
      lv_take = mv_left.
      IF lv_take > iv_max.
        lv_take = iv_max.
      ENDIF.
      IF mo_inflate IS NOT BOUND AND iv_max_out > 0 AND lv_take > iv_max_out.
        lv_take = iv_max_out.
      ENDIF.
      IF lv_take > 0.
        lv_data = mo_source->read( iv_pos = mv_pos iv_len = lv_take ).
        IF xstrlen( lv_data ) < lv_take.
          mv_open = abap_false.
          fail( |{ ms_entry-name } is cut short: the archive ends inside it| ).
        ENDIF.
        mv_pos = mv_pos + lv_take.
        mv_left = mv_left - lv_take.
      ENDIF.
    ENDIF.
    IF mo_inflate IS BOUND.
      TRY.
          rv_data = mo_inflate->feed( iv_data = lv_data iv_max_out = iv_max_out ).
        CATCH zcx_osd_inflate INTO lx_inflate.
          mv_open = abap_false.
          fail( |{ ms_entry-name }: { lx_inflate->reason }| ).
      ENDTRY.
      lv_paused = mo_inflate->is_paused( ).
    ELSE.
      rv_data = lv_data.
    ENDIF.
    mo_crc->update( rv_data ).
    mv_produced = mv_produced + xstrlen( rv_data ).
    " more than the directory promised: a damaged entry or a bomb, stopped
    " as soon as it shows and not at its end
    IF mv_produced > ms_entry-size.
      mv_open = abap_false.
      fail( |{ ms_entry-name }: more than the { ms_entry-size } bytes the directory gives| ).
    ENDIF.
    IF mv_left = 0 AND lv_paused = abap_false.
      finish_entry( ).
    ENDIF.
  ENDMETHOD.

  METHOD finish_entry.
    DATA lx_inflate TYPE REF TO zcx_osd_inflate.
    " a check that fails leaves no entry open, so a READ after it raises too
    mv_eof = abap_true.
    mv_open = abap_false.
    IF mo_inflate IS BOUND.
      TRY.
          mo_inflate->finish( ).
        CATCH zcx_osd_inflate INTO lx_inflate.
          fail( |{ ms_entry-name }: { lx_inflate->reason }| ).
      ENDTRY.
    ENDIF.
    IF mv_produced <> ms_entry-size.
      fail( |{ ms_entry-name }: { mv_produced } bytes instead of { ms_entry-size }| ).
    ENDIF.
    IF mo_crc->value( ) <> ms_entry-crc32.
      fail( |{ ms_entry-name }: CRC-32 does not match| ).
    ENDIF.
    mv_open = abap_true.
  ENDMETHOD.

  METHOD is_eof.
    rv_eof = mv_eof.
  ENDMETHOD.

  METHOD read_all.
    DATA lv_piece TYPE xstring.
    open( iv_name ).
    WHILE mv_eof = abap_false.
      lv_piece = read( ).
      CONCATENATE rv_data lv_piece INTO rv_data IN BYTE MODE.
    ENDWHILE.
  ENDMETHOD.

ENDCLASS.
