* The read of ZCL_O4D_HTTP_HANDLER=>GET_AUDIO_FROM_SMW0 / GET_IMAGE_FROM_SMW0
* and of ZCL_ORK_00_GAME_LOADER_SMW0=>LOAD without their SELECT on
* WWWPARAMS for the size (a SELECT ... WHERE col = value INTO TABLE is not
* in the subset yet): WWWDATA_IMPORT into a W3MIMETABTYPE or a STANDARD
* TABLE OF w3mime, then SCMS_BINARY_TO_XSTRING cut to the size.
* tools/gogen/mediacheck.mjs compares what it returns with the files.
CLASS zcl_gogen_t_w3miload DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS load_image
      IMPORTING iv_name TYPE string iv_size TYPE i
      EXPORTING ev_data TYPE xstring ev_subrc TYPE i.
    CLASS-METHODS load_audio
      IMPORTING iv_name TYPE string iv_size TYPE i
      EXPORTING ev_data TYPE xstring ev_subrc TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_w3miload IMPLEMENTATION.
  METHOD load_image.
    DATA: lt_mime TYPE w3mimetabtype, ls_key TYPE wwwdatatab.
    ls_key-relid = 'MI'. ls_key-objid = iv_name.
    CALL FUNCTION 'WWWDATA_IMPORT' EXPORTING key = ls_key TABLES mime = lt_mime EXCEPTIONS OTHERS = 1.
    ev_subrc = sy-subrc.
    IF sy-subrc <> 0. RETURN. ENDIF.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = iv_size IMPORTING buffer = ev_data TABLES binary_tab = lt_mime.
  ENDMETHOD.

  METHOD load_audio.
    DATA: lt_mime TYPE STANDARD TABLE OF w3mime, ls_key TYPE wwwdatatab.
    ls_key-relid = 'MI'. ls_key-objid = iv_name.
    CALL FUNCTION 'WWWDATA_IMPORT' EXPORTING key = ls_key TABLES mime = lt_mime EXCEPTIONS OTHERS = 1.
    ev_subrc = sy-subrc.
    IF sy-subrc <> 0. RETURN. ENDIF.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = iv_size IMPORTING buffer = ev_data TABLES binary_tab = lt_mime.
  ENDMETHOD.
ENDCLASS.
