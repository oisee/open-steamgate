* escape( val = v format = cl_abap_format=>e_json_string ) (parity-wave1,
* /UI2/CL_JSON=>SERIALIZE_INT): printable characters, every control
* character U+0000..U+001F and U+007F, three beyond ASCII, a c operand and
* a generic one, each result as its UTF-8 bytes. Run on A4H as written.
CLASS zcl_gogen_t_jsesc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS hex IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS gen IMPORTING iv TYPE data RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_jsesc IMPLEMENTATION.
  METHOD hex.
    DATA lo_out TYPE REF TO cl_abap_conv_out_ce.
    DATA lv_x TYPE xstring.
    lo_out = cl_abap_conv_out_ce=>create( encoding = 'UTF-8' ).
    lo_out->convert( EXPORTING data = iv IMPORTING buffer = lv_x ).
    rv = |{ lv_x }|.
  ENDMETHOD.

  METHOD gen.
    rv = escape( val = iv format = cl_abap_format=>e_json_string ).
  ENDMETHOD.

  METHOD run.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 6.
    DATA lv_i TYPE i.
    lv_s = escape( val = `a\b"c/d'e f ` format = cl_abap_format=>e_json_string ).
    rv = |p:[{ lv_s }]|.
    rv = |{ rv } cc:|.
    DO 33 TIMES.
      lv_i = sy-index - 1.
      IF lv_i = 32.
        lv_i = 127.
      ENDIF.
      lv_s = escape( val = cl_abap_conv_in_ce=>uccpi( lv_i ) format = cl_abap_format=>e_json_string ).
      rv = |{ rv }{ hex( lv_s ) },|.
    ENDDO.
    lv_s = cl_abap_conv_in_ce=>uccpi( 233 ) && cl_abap_conv_in_ce=>uccpi( 8364 ) && cl_abap_conv_in_ce=>uccpi( 8232 ).
    lv_s = escape( val = lv_s format = cl_abap_format=>e_json_string ).
    rv = |{ rv } u:{ hex( lv_s ) }|.
    lv_c = 'a"b'.
    lv_s = escape( val = lv_c format = cl_abap_format=>e_json_string ).
    rv = |{ rv } c:[{ lv_s }]{ strlen( lv_s ) }|.
    lv_s = `x"y `.
    rv = |{ rv } g:[{ gen( lv_s ) }][{ gen( lv_c ) }]|.
  ENDMETHOD.
ENDCLASS.
