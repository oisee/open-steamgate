* escape( val = v format = cl_abap_format=>e_json_string ) (parity-wave1,
* /UI2/CL_JSON=>SERIALIZE_INT): printable characters, every control
* character U+0000..U+001F, U+007F, three beyond ASCII (kept or not), a c
* operand and a generic one. Run on A4H as written.
CLASS zcl_gogen_t_jsesc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS gen IMPORTING iv TYPE data RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_jsesc IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = `1`.
    ELSE.
      rv = `0`.
    ENDIF.
  ENDMETHOD.

  METHOD gen.
    rv = escape( val = iv format = cl_abap_format=>e_json_string ).
  ENDMETHOD.

  METHOD run.
    DATA lv_s TYPE string.
    DATA lv_in TYPE string.
    DATA lv_c TYPE c LENGTH 6.
    DATA lv_i TYPE i.
    lv_s = escape( val = `a\b"c/d'e f ` format = cl_abap_format=>e_json_string ).
    rv = |p:[{ lv_s }]|.
    rv = |{ rv } cc:|.
    DO 32 TIMES.
      lv_i = sy-index - 1.
      lv_s = escape( val = cl_abap_conv_in_ce=>uccpi( lv_i ) format = cl_abap_format=>e_json_string ).
      rv = |{ rv }{ lv_s },|.
    ENDDO.
    lv_in = cl_abap_conv_in_ce=>uccpi( 127 ).
    lv_s = escape( val = lv_in format = cl_abap_format=>e_json_string ).
    rv = |{ rv } del:{ strlen( lv_s ) }{ b( xsdbool( lv_s = lv_in ) ) }|.
    lv_in = cl_abap_conv_in_ce=>uccpi( 233 ) && cl_abap_conv_in_ce=>uccpi( 8364 ) && cl_abap_conv_in_ce=>uccpi( 8232 ).
    lv_s = escape( val = lv_in format = cl_abap_format=>e_json_string ).
    rv = |{ rv } u:{ strlen( lv_s ) }{ b( xsdbool( lv_s = lv_in ) ) }|.
    lv_c = 'a"b'.
    lv_s = escape( val = lv_c format = cl_abap_format=>e_json_string ).
    rv = |{ rv } c:[{ lv_s }]{ strlen( lv_s ) }|.
    lv_s = `x"y `.
    rv = |{ rv } g:[{ gen( lv_s ) }][{ gen( lv_c ) }]|.
  ENDMETHOD.
ENDCLASS.
