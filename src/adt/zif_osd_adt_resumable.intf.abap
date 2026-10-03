"! A continuation owner. Called only in a fresh dialog step; no COMMIT/ROLLBACK.
INTERFACE zif_osd_adt_resumable PUBLIC.
  METHODS resume
    IMPORTING iv_kind TYPE string
              iv_json TYPE string
    RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
    RAISING zcx_osd_adt.
ENDINTERFACE.
