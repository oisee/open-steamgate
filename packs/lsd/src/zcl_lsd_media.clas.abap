CLASS zcl_lsd_media DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  " An SMW0 object of the pack as bytes: the recording and the music travel
  " the way the demo's pictures do, WWWDATA_IMPORT into a MIME table and
  " SCMS_BINARY_TO_XSTRING out of it, the size from the object's parameters.
  PUBLIC SECTION.
    CLASS-METHODS load
      IMPORTING iv_name        TYPE wwwdatatab-objid
      EXPORTING ev_data        TYPE xstring
                ev_size        TYPE i.
ENDCLASS.

CLASS zcl_lsd_media IMPLEMENTATION.

  METHOD load.
    DATA: lt_mime   TYPE w3mimetabtype,
          ls_key    TYPE wwwdatatab,
          lt_params TYPE STANDARD TABLE OF wwwparams.
    CLEAR: ev_data, ev_size.
    ls_key-relid = 'MI'.
    ls_key-objid = iv_name.
    SELECT * FROM wwwparams INTO TABLE lt_params WHERE relid = ls_key-relid AND objid = ls_key-objid.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    READ TABLE lt_params INTO DATA(ls_param) WITH KEY name = 'filesize'.
    IF sy-subrc = 0.
      ev_size = ls_param-value.
    ENDIF.
    CALL FUNCTION 'WWWDATA_IMPORT'
      EXPORTING
        key    = ls_key
      TABLES
        mime   = lt_mime
      EXCEPTIONS
        OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING'
      EXPORTING
        input_length = ev_size
      IMPORTING
        buffer       = ev_data
      TABLES
        binary_tab   = lt_mime.
  ENDMETHOD.

ENDCLASS.
