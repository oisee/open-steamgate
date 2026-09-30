"! A zip already in memory (a test, an uploaded body)
CLASS zcl_osd_zip_source_x DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_zip_source.
    METHODS constructor
      IMPORTING iv_data TYPE xstring.
  PRIVATE SECTION.
    DATA mv_data TYPE xstring.
ENDCLASS.


CLASS zcl_osd_zip_source_x IMPLEMENTATION.

  METHOD constructor.
    mv_data = iv_data.
  ENDMETHOD.

  METHOD zif_osd_zip_source~size.
    rv_size = xstrlen( mv_data ).
  ENDMETHOD.

  METHOD zif_osd_zip_source~read.
    DATA lv_len TYPE i.
    IF iv_pos < 0 OR iv_pos > xstrlen( mv_data ) OR iv_len < 0.
      RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = `read outside the archive`.
    ENDIF.
    lv_len = xstrlen( mv_data ) - iv_pos.
    IF lv_len > iv_len.
      lv_len = iv_len.
    ENDIF.
    rv_data = mv_data+iv_pos(lv_len).
  ENDMETHOD.

ENDCLASS.
