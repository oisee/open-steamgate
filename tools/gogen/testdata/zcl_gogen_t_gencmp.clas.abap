* Comparisons of a generic operand (TYPE any) with a c or a string
* (parity-wave1: ZCL_STG_SEGW_IMPORT=>IMPORT, ZCL_STG_SEGW_FUGR=>SIGNATURE),
* beside the same comparisons of typed operands. Run on A4H as written.
CLASS zcl_gogen_t_gencmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_gencmp IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = `1`.
    ELSE.
      rv = `0`.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA lv_c10 TYPE c LENGTH 10.
    DATA lv_c1 TYPE c LENGTH 1.
    DATA lv_s TYPE string.
    DATA lv_sb TYPE string.
    FIELD-SYMBOLS <v> TYPE any.
    lv_c10 = 'AB'.
    lv_s = `AB`.
    lv_sb = `AB `.
    rv = |ty:{ b( xsdbool( lv_s = lv_c10 ) ) }{ b( xsdbool( lv_sb = lv_c10 ) ) }{ b( xsdbool( lv_sb > lv_c10 ) ) }{ b( xsdbool( lv_sb = 'AB' ) ) }{ b( xsdbool( lv_c10 = 'AB ' ) ) }|.
    ASSIGN lv_c10 TO <v>.
    rv = |{ rv } c:{ b( xsdbool( lv_s = <v> ) ) }{ b( xsdbool( lv_sb = <v> ) ) }{ b( xsdbool( lv_sb > <v> ) ) }{ b( xsdbool( <v> = 'AB' ) ) }{ b( xsdbool( <v> = 'AB ' ) ) }|
      && |{ b( xsdbool( <v> = 'ab' ) ) }{ b( xsdbool( <v> < 'AC' ) ) }{ b( xsdbool( <v> <> lv_sb ) ) }{ b( xsdbool( <v> >= `AA` ) ) }{ b( xsdbool( <v> < `AB ` ) ) }|.
    ASSIGN lv_sb TO <v>.
    rv = |{ rv } s:{ b( xsdbool( <v> = 'AB' ) ) }{ b( xsdbool( <v> = lv_s ) ) }{ b( xsdbool( <v> > lv_s ) ) }{ b( xsdbool( lv_c10 = <v> ) ) }{ b( xsdbool( <v> = `AB ` ) ) }{ b( xsdbool( <v> > 'AB' ) ) }|.
    ASSIGN lv_c1 TO <v>.
    rv = |{ rv } c1:{ b( xsdbool( <v> = 'X' ) ) }{ b( xsdbool( <v> = '' ) ) }{ b( xsdbool( <v> = space ) ) }{ b( xsdbool( <v> = `` ) ) }{ b( xsdbool( <v> = ` ` ) ) }|.
    lv_c1 = 'X'.
    rv = |{ rv },{ b( xsdbool( <v> = 'X' ) ) }{ b( xsdbool( <v> = 'x' ) ) }{ b( xsdbool( <v> <> 'X' ) ) }{ b( xsdbool( <v> = `X` ) ) }{ b( xsdbool( <v> = 'XY' ) ) }|.
  ENDMETHOD.
ENDCLASS.
