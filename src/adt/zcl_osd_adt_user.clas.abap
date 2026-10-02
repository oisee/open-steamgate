"! Basic credentials quote the user; they are not authentication here.
CLASS zcl_osd_adt_user DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS from_basic IMPORTING iv_header TYPE string iv_default TYPE string DEFAULT `DEVELOPER`
      RETURNING VALUE(rv_user) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_user IMPLEMENTATION.
  METHOD from_basic.
    DATA lv_encoded TYPE string.
    DATA lv_bytes TYPE xstring.
    DATA lv_text TYPE string.
    DATA lv_password TYPE string.
    DATA lo_conv TYPE REF TO cl_abap_conv_in_ce.
    rv_user = iv_default.
    IF strlen( iv_header ) < 6 OR to_lower( iv_header(6) ) <> `basic `.
      RETURN.
    ENDIF.
    TRY.
        lv_encoded = substring( val = iv_header off = 6 ).
        lv_bytes = cl_http_utility=>decode_x_base64( lv_encoded ).
        lo_conv = cl_abap_conv_in_ce=>create( encoding = 'UTF-8' ignore_cerr = abap_true ).
        lo_conv->convert( EXPORTING input = lv_bytes IMPORTING data = lv_text ).
        SPLIT lv_text AT `:` INTO lv_text lv_password.
        IF lv_text IS NOT INITIAL.
          rv_user = to_upper( lv_text ).
        ENDIF.
      CATCH cx_root.
        rv_user = iv_default.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
