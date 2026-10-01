"! One entry of a zip archive as a byte source: each NEXT inflates at most
"! IV_CHUNK more bytes (ZCL_OSD_ZIP_READER->READ with both of its limits), so
"! an entry is read in bounded memory however large it is.
"!
"! A zip bomb meets three stops. The reader's own: more output than the
"! central directory gives for the entry is an error as soon as it shows.
"! And two of this source's, for an entry whose directory size is itself
"! huge: IV_MAX_TOTAL bytes in all, and IV_MAX_RATIO output bytes per
"! compressed byte (both 0 = no limit). A stop, and a damaged entry, raise
"! ZCX_OSD_BYTE_SOURCE from NEXT; the end of the entry is an empty NEXT, then
"! every later one is empty too.
"!
"! Usage:
"!   CREATE OBJECT lo_zip EXPORTING io_source = lo_file.
"!   CREATE OBJECT lo_bytes TYPE zcl_osd_byte_source_zip
"!     EXPORTING io_zip = lo_zip iv_name = `feed.xml` iv_max_total = 2000000000.
"!   lo_reader = lo_factory->create( lo_bytes ).
CLASS zcl_osd_byte_source_zip DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_byte_source.
    "! Opens IV_NAME in IO_ZIP; an entry that is not there raises ZCX_OSD_ZIP
    METHODS constructor
      IMPORTING io_zip       TYPE REF TO zcl_osd_zip_reader
                iv_name      TYPE string
                iv_chunk     TYPE i DEFAULT 65536
                iv_max_total TYPE i DEFAULT 0
                iv_max_ratio TYPE i DEFAULT 0
      RAISING   zcx_osd_zip.
    "! The bytes handed out so far
    METHODS get_produced
      RETURNING VALUE(rv_produced) TYPE i.

  PRIVATE SECTION.
    DATA mo_zip TYPE REF TO zcl_osd_zip_reader.
    DATA mv_name TYPE string.
    DATA mv_chunk TYPE i.
    DATA mv_max_total TYPE i.
    DATA mv_max_ratio TYPE i.
    DATA mv_compressed TYPE i.
    DATA mv_produced TYPE i.
    DATA mv_done TYPE abap_bool.
ENDCLASS.

CLASS zcl_osd_byte_source_zip IMPLEMENTATION.
  METHOD constructor.
    DATA lt_entries TYPE zcl_osd_zip_reader=>tt_entry.
    DATA ls_entry TYPE zcl_osd_zip_reader=>ty_entry.
    mo_zip = io_zip.
    mv_name = iv_name.
    mv_chunk = iv_chunk.
    IF mv_chunk <= 0.
      mv_chunk = 65536.
    ENDIF.
    mv_max_total = iv_max_total.
    mv_max_ratio = iv_max_ratio.
    lt_entries = mo_zip->get_entries( ).
    READ TABLE lt_entries INTO ls_entry WITH KEY name = iv_name.
    mv_compressed = ls_entry-compressed_size.
    mo_zip->open( iv_name ).
  ENDMETHOD.

  METHOD get_produced.
    rv_produced = mv_produced.
  ENDMETHOD.

  METHOD zif_osd_byte_source~next.
    DATA lx_zip TYPE REF TO zcx_osd_zip.
    DATA lv_reason TYPE string.
    " compressed size times the ratio can pass the limit of i
    DATA lv_limit TYPE p LENGTH 16 DECIMALS 0.
    DATA lv_after TYPE p LENGTH 16 DECIMALS 0.
    IF mv_done = abap_true.
      RETURN.
    ENDIF.
    " a piece may be empty before the end (input that completes no output yet)
    WHILE rv IS INITIAL.
      IF mo_zip->is_eof( ) = abap_true.
        mv_done = abap_true.
        RETURN.
      ENDIF.
      TRY.
          rv = mo_zip->read( iv_max     = mv_chunk
                             iv_max_out = mv_chunk ).
        CATCH zcx_osd_zip INTO lx_zip.
          mv_done = abap_true.
          RAISE EXCEPTION TYPE zcx_osd_byte_source
            EXPORTING iv_reason = |{ mv_name }: { lx_zip->reason }|
                      previous  = lx_zip.
      ENDTRY.
    ENDWHILE.
    " compared before adding, so a count near the limit of i cannot overflow
    IF mv_max_total > 0 AND xstrlen( rv ) > mv_max_total - mv_produced.
      lv_reason = |{ mv_name }: more than { mv_max_total } bytes|.
    ELSEIF mv_max_ratio > 0 AND mv_compressed > 0.
      lv_limit = mv_compressed.
      lv_limit = lv_limit * mv_max_ratio.
      lv_after = mv_produced.
      lv_after = lv_after + xstrlen( rv ).
      IF lv_after > lv_limit.
        lv_reason = |{ mv_name }: inflates to more than { mv_max_ratio } times its { mv_compressed } compressed bytes|.
      ENDIF.
    ENDIF.
    IF lv_reason IS NOT INITIAL.
      mv_done = abap_true.
      CLEAR rv.
      RAISE EXCEPTION TYPE zcx_osd_byte_source
        EXPORTING iv_reason = lv_reason.
    ENDIF.
    mv_produced = mv_produced + xstrlen( rv ).
  ENDMETHOD.
ENDCLASS.
