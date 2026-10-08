CLASS zcl_osgt_decode_base64 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run IMPORTING iv_encoded TYPE string RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.
CLASS zcl_osgt_decode_base64 IMPLEMENTATION.
  METHOD run.
    rv_text = cl_http_utility=>decode_base64( iv_encoded ).
  ENDMETHOD.
ENDCLASS.
