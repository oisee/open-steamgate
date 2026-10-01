"! A file on the application server as a byte source: OPEN DATASET ... IN
"! BINARY MODE, then READ DATASET ... MAXIMUM LENGTH one chunk per NEXT, so a
"! file of any size costs one chunk at a time.
"!
"! The path is used as given: it is not validated (no FILE_VALIDATE_NAME,
"! no logical file name), so a caller taking it from a user checks it
"! first. A file that cannot be opened or read raises ZCX_OSD_BYTE_SOURCE
"! with the system's message (an authority refusal included). The file is
"! closed at its end; a caller that stops early, or whose reader fails,
"! calls CLOSE. After the end or CLOSE, NEXT answers empty, forever.
CLASS zcl_osd_byte_source_dataset DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_byte_source.
    CONSTANTS c_default_chunk TYPE i VALUE 65536.
    METHODS constructor
      IMPORTING iv_file  TYPE string
                iv_chunk TYPE i DEFAULT c_default_chunk.
    "! closes the file; harmless when it is closed already
    METHODS close.
  PRIVATE SECTION.
    DATA mv_file TYPE string.
    DATA mv_chunk TYPE i.
    DATA mv_open TYPE abap_bool.
ENDCLASS.


CLASS zcl_osd_byte_source_dataset IMPLEMENTATION.

  METHOD constructor.
    DATA lv_message TYPE string.
    DATA lx_authority TYPE REF TO cx_sy_file_authority.
    DATA lx_open TYPE REF TO cx_sy_file_open.
    mv_file = iv_file.
    mv_chunk = iv_chunk.
    IF mv_chunk <= 0.
      mv_chunk = c_default_chunk.
    ENDIF.
    TRY.
        OPEN DATASET mv_file FOR INPUT IN BINARY MODE MESSAGE lv_message.
      CATCH cx_sy_file_authority INTO lx_authority.
        RAISE EXCEPTION TYPE zcx_osd_byte_source
          EXPORTING iv_reason = |no authority to read { iv_file }|
                    previous  = lx_authority.
      CATCH cx_sy_file_open INTO lx_open.
* the file is open already in this internal session
        RAISE EXCEPTION TYPE zcx_osd_byte_source
          EXPORTING iv_reason = |{ iv_file } is open already|
                    previous  = lx_open.
    ENDTRY.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_osd_byte_source
        EXPORTING iv_reason = |cannot open { iv_file }: { lv_message }|.
    ENDIF.
    mv_open = abap_true.
  ENDMETHOD.

  METHOD close.
    IF mv_open = abap_true.
      CLOSE DATASET mv_file.
      mv_open = abap_false.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_byte_source~next.
* the last piece of a file comes with SY-SUBRC 4 and its bytes: it is
* handed out, and the call after it is the end
    DATA lv_actual TYPE i.
    DATA lx_io TYPE REF TO cx_sy_file_io.
    IF mv_open = abap_false.
      RETURN.
    ENDIF.
    TRY.
        READ DATASET mv_file INTO rv MAXIMUM LENGTH mv_chunk ACTUAL LENGTH lv_actual.
      CATCH cx_sy_file_io INTO lx_io.
        close( ).
        RAISE EXCEPTION TYPE zcx_osd_byte_source
          EXPORTING iv_reason = |cannot read { mv_file }|
                    previous  = lx_io.
    ENDTRY.
    IF sy-subrc <> 0 OR lv_actual = 0.
      close( ).
    ENDIF.
    IF lv_actual = 0.
      CLEAR rv.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
