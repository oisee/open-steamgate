CLASS zcl_gogen_t_travconv DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS trip IMPORTING iv_enc TYPE abap_encoding
                                 iv     TYPE string
                       RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS cut IMPORTING iv_enc TYPE abap_encoding
                                iv     TYPE string
                                iv_n   TYPE i
                      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_travconv IMPLEMENTATION.
  METHOD trip.
    " text to bytes and back: the bytes, then whether the text came back
    DATA lo_out TYPE REF TO cl_abap_conv_out_ce.
    DATA lo_in TYPE REF TO cl_abap_conv_in_ce.
    DATA lv_x TYPE xstring.
    DATA lv_s TYPE string.
    lo_out = cl_abap_conv_out_ce=>create( encoding = iv_enc ).
    lo_out->convert( EXPORTING data = iv IMPORTING buffer = lv_x ).
    lo_in = cl_abap_conv_in_ce=>create( encoding = iv_enc ).
    lo_in->convert( EXPORTING input = lv_x IMPORTING data = lv_s ).
    IF lv_s = iv.
      rv = |{ lv_x }>same|.
    ELSE.
      rv = |{ lv_x }>other|.
    ENDIF.
  ENDMETHOD.

  METHOD cut.
    DATA lo_out TYPE REF TO cl_abap_conv_out_ce.
    DATA lv_x TYPE xstring.
    lo_out = cl_abap_conv_out_ce=>create( encoding = iv_enc ).
    lo_out->convert( EXPORTING data = iv n = iv_n IMPORTING buffer = lv_x ).
    rv = |{ lv_x }|.
  ENDMETHOD.

  METHOD run.
    " a, a-umlaut (U+00E4), euro sign (U+20AC); the source stays 7-bit
    DATA lv_text TYPE string.
    lv_text = `a` && cl_abap_conv_in_ce=>uccpi( 228 ) && cl_abap_conv_in_ce=>uccpi( 8364 ).
    rv = |u8:{ trip( iv_enc = 'UTF-8' iv = lv_text ) }|
      && | u16:{ trip( iv_enc = '4103' iv = lv_text ) }|
      && | cut8:{ cut( iv_enc = 'UTF-8' iv = `abcd` iv_n = 2 ) }|
      && | cut16:{ cut( iv_enc = '4103' iv = `abcd` iv_n = 3 ) }|.
  ENDMETHOD.
ENDCLASS.
