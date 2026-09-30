"! A zip on the application server's file system, read with OPEN DATASET:
"! SET DATASET POSITION and READ DATASET MAXIMUM LENGTH take only the bytes
"! asked for, so an archive of any size costs the central directory and one
"! piece at a time. CLOSE when done.
CLASS zcl_osd_zip_source_dataset DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_zip_source.
    METHODS constructor
      IMPORTING iv_file TYPE string
      RAISING   zcx_osd_zip.
    METHODS close.
  PRIVATE SECTION.
    DATA mv_file TYPE string.
    DATA mv_size TYPE i.
ENDCLASS.


CLASS zcl_osd_zip_source_dataset IMPLEMENTATION.

  METHOD constructor.
    DATA lv_message TYPE string.
    mv_file = iv_file.
    OPEN DATASET mv_file FOR INPUT IN BINARY MODE MESSAGE lv_message.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = |cannot open { iv_file }: { lv_message }|.
    ENDIF.
    SET DATASET mv_file POSITION END OF FILE.
    GET DATASET mv_file POSITION mv_size.
  ENDMETHOD.

  METHOD close.
    CLOSE DATASET mv_file.
  ENDMETHOD.

  METHOD zif_osd_zip_source~size.
    rv_size = mv_size.
  ENDMETHOD.

  METHOD zif_osd_zip_source~read.
    DATA lv_actual TYPE i.
    IF iv_pos < 0 OR iv_pos > mv_size OR iv_len < 0.
      RAISE EXCEPTION TYPE zcx_osd_zip EXPORTING iv_reason = `read outside the archive`.
    ENDIF.
    IF iv_len = 0.
      RETURN.
    ENDIF.
    SET DATASET mv_file POSITION iv_pos.
    READ DATASET mv_file INTO rv_data MAXIMUM LENGTH iv_len ACTUAL LENGTH lv_actual.
  ENDMETHOD.

ENDCLASS.
