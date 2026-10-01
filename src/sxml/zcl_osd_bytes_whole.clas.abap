"! The whole xstring as one chunk, then end of stream.
CLASS zcl_osd_bytes_whole DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_byte_source.
    METHODS constructor
      IMPORTING iv_bytes TYPE xstring.
  PRIVATE SECTION.
    DATA mv_bytes TYPE xstring.
    DATA mv_done TYPE abap_bool.
ENDCLASS.


CLASS zcl_osd_bytes_whole IMPLEMENTATION.

  METHOD constructor.
    mv_bytes = iv_bytes.
  ENDMETHOD.

  METHOD zif_osd_byte_source~next.
    IF mv_done = abap_false.
      rv = mv_bytes.
      mv_done = abap_true.
      CLEAR mv_bytes.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
