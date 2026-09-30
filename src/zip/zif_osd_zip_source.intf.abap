"! Where ZCL_OSD_ZIP_READER takes its bytes from: random access by position,
"! so a zip is read from its end (the central directory) without being loaded
INTERFACE zif_osd_zip_source PUBLIC.
  METHODS size
    RETURNING VALUE(rv_size) TYPE i
    RAISING   zcx_osd_zip.
  "! Up to IV_LEN bytes from IV_POS; fewer only at the end
  METHODS read
    IMPORTING iv_pos         TYPE i
              iv_len         TYPE i
    RETURNING VALUE(rv_data) TYPE xstring
    RAISING   zcx_osd_zip.
ENDINTERFACE.
