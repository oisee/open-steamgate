CLASS zcl_gogen_t_cp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_cp IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = `X`.
    ELSE.
      rv = `-`.
    ENDIF.
  ENDMETHOD.
  METHOD run.
    DATA lv_c TYPE c LENGTH 10.
    DATA lv_s TYPE string.
    DATA lv_e TYPE string.
    lv_c = 'ab'.
    lv_s = `ab `.
    rv = |cp:{ b( boolc( 'Hello' CP 'h*' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CP 'a+c' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CP 'a+' ) ) }|.
    rv = |{ rv }{ b( boolc( 'a*c' CP 'a#*c' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CP 'a#*c' ) ) }|.
    rv = |{ rv }{ b( boolc( 'ABC' CP '#a*' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CP '#a*' ) ) }|.
    rv = |{ rv }{ b( boolc( lv_c CP 'ab' ) ) }|.
    rv = |{ rv }{ b( boolc( lv_s CP 'ab' ) ) }|.
    rv = |{ rv }{ b( boolc( lv_s CP `ab ` ) ) }|.
    rv = |{ rv }{ b( boolc( lv_e CP '*' ) ) }|.
    rv = |{ rv }{ b( boolc( lv_e CP '' ) ) }|.
    rv = |{ rv }{ b( boolc( 'ab' CP 'ab ' ) ) }|.
    rv = |{ rv }{ b( boolc( 'x+y' CP '+*' ) ) }|.
    rv = |{ rv }{ b( boolc( '/$batch' CP '/$metadata*' ) ) }|.
    rv = |{ rv }{ b( boolc( 'a#b' CP 'a##b' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' NP 'x*' ) ) }|.
    rv = |{ rv } ca:{ b( boolc( 'abc' CA 'xb' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CA 'B' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' CA '' ) ) }|.
    rv = |{ rv }{ b( boolc( lv_e CA 'a' ) ) }|.
    rv = |{ rv }{ b( boolc( 'abc' NA 'xyz' ) ) }|.
  ENDMETHOD.
ENDCLASS.
