"! A file on the application server as a byte source: OPEN DATASET ... IN
"! BINARY MODE, then READ DATASET ... MAXIMUM LENGTH one chunk per NEXT, so a
"! file of any size costs one chunk at a time. The file is closed at its
"! end (or by CLOSE); after that NEXT answers empty, forever.
CLASS zcl_osd_byte_source_dataset DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_byte_source.
    CONSTANTS c_default_chunk TYPE i VALUE 65536.
    "! raises CX_SY_FILE_OPEN when the file cannot be opened for reading
    METHODS constructor
      IMPORTING iv_file  TYPE string
                iv_chunk TYPE i DEFAULT c_default_chunk
      RAISING   cx_sy_file_open.
    METHODS close.
  PRIVATE SECTION.
    DATA mv_file TYPE string.
    DATA mv_chunk TYPE i.
    DATA mv_open TYPE abap_bool.
ENDCLASS.


CLASS zcl_osd_byte_source_dataset IMPLEMENTATION.

  METHOD constructor.
    DATA lv_message TYPE string.
    mv_file = iv_file.
    mv_chunk = iv_chunk.
    IF mv_chunk <= 0.
      mv_chunk = c_default_chunk.
    ENDIF.
    OPEN DATASET mv_file FOR INPUT IN BINARY MODE MESSAGE lv_message.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE cx_sy_file_open.
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
    IF mv_open = abap_false.
      RETURN.
    ENDIF.
    READ DATASET mv_file INTO rv MAXIMUM LENGTH mv_chunk ACTUAL LENGTH lv_actual.
    IF sy-subrc <> 0 OR lv_actual = 0.
      close( ).
    ENDIF.
    IF lv_actual = 0.
      CLEAR rv.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
