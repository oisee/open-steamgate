* cl_abap_conv_in_ce=>uccp( 'hhhh' ): the character of a code point written
* as four hex digits (A4H 2026-09-24, measured in $ZOSG_TMP_0400). Lower-case
* hex is no hex digit to the c -> x move inside it: uccp( '00e4' ) is
* U+0000 there (uccpi 0), so the front end takes upper case only
CLASS zcl_gogen_t_uccp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_uccp IMPLEMENTATION.
  METHOD run.
    DATA lv_c TYPE c LENGTH 1.
    DATA lv_s TYPE string.
    lv_c = cl_abap_conv_in_ce=>uccp( '0041' ).
    lv_s = cl_abap_conv_in_ce=>uccp( 'FEFF' ).
    rv = |{ lv_c }/{ strlen( lv_s ) }/{ cl_abap_conv_out_ce=>uccpi( lv_s ) }|.
  ENDMETHOD.
ENDCLASS.
