CLASS zcl_gogen_t_xcmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
* byte-like comparisons, measured on A4H 2026-09-24 ($ZOSG_TMP_0480): the
* bodies of RUN1, RUN2, STR and MOV are the probes ZCL_GOGEN_T_XCMP,
* ZCL_GOGEN_T_XCMP2 (RUN) and ZCL_GOGEN_T_XCMP3 (STR, MOV) as run there
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS run1 RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS run2 RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS str RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS mov RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS b IMPORTING iv TYPE abap_bool RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xcmp IMPLEMENTATION.
  METHOD b.
    IF iv = abap_true.
      rv = '1'.
    ELSE.
      rv = '0'.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    rv = |{ run1( ) }; { run2( ) }; { str( ) }; { mov( ) }|.
  ENDMETHOD.

  METHOD run1.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lv_ys TYPE xstring.
    DATA lv_hex TYPE xstring.
    DATA lv_at TYPE i.
    DATA lv_r TYPE string.
*   x(1) against c literals
    lv_x1 = '00'.
    lv_r = |{ b( boolc( lv_x1 = '00' ) ) }{ b( boolc( lv_x1 = '0' ) ) }{ b( boolc( lv_x1 = '000' ) ) }{ b( boolc( lv_x1 = '00 ' ) ) }|.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = ' ' ) ) }{ b( boolc( lv_x1 = '' ) ) }{ b( boolc( lv_x1 = `00` ) ) }{ b( boolc( lv_x1 <> '00' ) ) }|.
    rv = |a:{ lv_r }|.
    lv_x1 = 'FF'.
    lv_r = |{ b( boolc( lv_x1 = 'FF' ) ) }{ b( boolc( lv_x1 = 'ff' ) ) }{ b( boolc( lv_x1 < 'ff' ) ) }{ b( boolc( lv_x1 > 'ff' ) ) }{ b( boolc( lv_x1 > 'FE' ) ) }{ b( boolc( lv_x1 < 'G0' ) ) }|.
    rv = |{ rv } b:{ lv_r }|.
    lv_x1 = '0A'.
    lv_r = |{ b( boolc( lv_x1 = '0A' ) ) }{ b( boolc( lv_x1 = '0a' ) ) }{ b( boolc( lv_x1 < '0B' ) ) }{ b( boolc( lv_x1 > '09' ) ) }{ b( boolc( lv_x1 <> '0A' ) ) }{ b( boolc( lv_x1 < '0A0' ) ) }{ b( boolc( lv_x1 = 'A' ) ) }|.
    rv = |{ rv } c:{ lv_r }|.
*   x(2) against c literals
    lv_x2 = '0000'.
    lv_r = |{ b( boolc( lv_x2 = '00' ) ) }{ b( boolc( lv_x2 = '0000' ) ) }{ b( boolc( lv_x2 = '000' ) ) }|.
    lv_x2 = 'AB00'.
    lv_r = |{ lv_r }{ b( boolc( lv_x2 = 'AB' ) ) }{ b( boolc( lv_x2 = 'AB00' ) ) }{ b( boolc( lv_x2 > 'AB' ) ) }{ b( boolc( lv_x2 = 'AB00  ' ) ) }|.
    rv = |{ rv } d:{ lv_r }|.
*   xstring against c literals
    lv_xs = '00'.
    lv_r = |{ b( boolc( lv_xs = '00' ) ) }{ b( boolc( lv_xs = '0' ) ) }{ b( boolc( lv_xs = '000' ) ) }{ b( boolc( lv_xs = '0000' ) ) }{ b( boolc( lv_xs = `00 ` ) ) }|.
    CLEAR lv_xs.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = '' ) ) }{ b( boolc( lv_xs = ' ' ) ) }{ b( boolc( lv_xs = '00' ) ) }{ b( boolc( lv_xs < '00' ) ) }{ b( boolc( lv_xs = `` ) ) }|.
    lv_xs = 'ABCD'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs < 'ABCE' ) ) }{ b( boolc( lv_xs > 'ABC' ) ) }{ b( boolc( lv_xs = 'abcd' ) ) }{ b( boolc( lv_xs < 'abcd' ) ) }{ b( boolc( lv_xs = 'ABCD00' ) ) }|.
    rv = |{ rv } e:{ lv_r }|.
*   xstring against xstring
    lv_xs = 'AB'.
    lv_ys = 'ABCD'.
    lv_r = |{ b( boolc( lv_xs = lv_ys ) ) }{ b( boolc( lv_xs < lv_ys ) ) }{ b( boolc( lv_xs > lv_ys ) ) }|.
    lv_ys = 'AB00'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = lv_ys ) ) }{ b( boolc( lv_xs < lv_ys ) ) }{ b( boolc( lv_xs > lv_ys ) ) }|.
    lv_xs = 'AC'.
    lv_ys = 'ABCD'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs < lv_ys ) ) }{ b( boolc( lv_xs > lv_ys ) ) }|.
    CLEAR lv_xs.
    lv_ys = '00'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = lv_ys ) ) }{ b( boolc( lv_xs < lv_ys ) ) }{ b( boolc( lv_xs <> lv_ys ) ) }|.
    lv_xs = 'FF'.
    lv_ys = '0001'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs > lv_ys ) ) }|.
    rv = |{ rv } f:{ lv_r }|.
*   x against x of another length, x against xstring
    lv_x1 = 'AB'.
    lv_x2 = 'AB00'.
    lv_r = |{ b( boolc( lv_x1 = lv_x2 ) ) }{ b( boolc( lv_x1 < lv_x2 ) ) }|.
    lv_x2 = 'ABCD'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = lv_x2 ) ) }{ b( boolc( lv_x1 < lv_x2 ) ) }|.
    lv_x1 = 'AC'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 < lv_x2 ) ) }{ b( boolc( lv_x1 > lv_x2 ) ) }|.
    lv_x2 = 'AB00'.
    lv_xs = 'AB'.
    lv_r = |{ lv_r }{ b( boolc( lv_x2 = lv_xs ) ) }{ b( boolc( lv_x2 > lv_xs ) ) }{ b( boolc( lv_xs < lv_x2 ) ) }|.
    lv_x1 = '00'.
    CLEAR lv_xs.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = lv_xs ) ) }{ b( boolc( lv_x1 > lv_xs ) ) }|.
    rv = |{ rv } g:{ lv_r }|.
*   offset and length on an xstring (ZCL_OSD_GIT=>UNTIL_NULL, PACK_OF)
    lv_xs = '4100425041434B'.
    lv_r = |{ b( boolc( lv_xs+1(1) = '00' ) ) }{ b( boolc( lv_xs+0(1) = '00' ) ) }{ b( boolc( lv_xs+0(1) = '41' ) ) }{ b( boolc( lv_xs+1(2) = '0042' ) ) }{ b( boolc( lv_xs+3 = '5041434B' ) ) }|.
    lv_at = 3.
    lv_hex = lv_xs+lv_at(4).
    lv_r = |{ lv_r }{ b( boolc( lv_hex = '5041434B' ) ) }{ b( boolc( lv_xs+lv_at(4) = '5041434B' ) ) }{ b( boolc( lv_xs+lv_at(2) < lv_hex ) ) }{ b( boolc( lv_xs+lv_at(2) = lv_xs+lv_at(2) ) ) }|.
    CLEAR lv_at.
    WHILE lv_at < xstrlen( lv_xs ).
      IF lv_xs+lv_at(1) = '00'.
        EXIT.
      ENDIF.
      lv_at = lv_at + 1.
    ENDWHILE.
    rv = |{ rv } h:{ lv_r }/{ lv_at }|.
  ENDMETHOD.

  METHOD run2.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lv_ys TYPE xstring.
    DATA lv_s TYPE string.
    DATA lv_r TYPE string.
    lv_x1 = 'AB'.
    lv_xs = 'ABCD'.
    lv_r = |{ b( boolc( lv_x1 = lv_xs ) ) }{ b( boolc( lv_x1 < lv_xs ) ) }{ b( boolc( lv_xs > lv_x1 ) ) }{ b( boolc( lv_xs = lv_x1 ) ) }|.
    lv_xs = 'AB00'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = lv_xs ) ) }{ b( boolc( lv_xs = lv_x1 ) ) }|.
    lv_xs = 'AA'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 > lv_xs ) ) }|.
    lv_xs = 'AC00'.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 < lv_xs ) ) }|.
    lv_x2 = 'AB00'.
    lv_xs = 'AB0000'.
    lv_r = |{ lv_r }{ b( boolc( lv_x2 = lv_xs ) ) }|.
    lv_xs = 'AB0001'.
    lv_r = |{ lv_r }{ b( boolc( lv_x2 = lv_xs ) ) }{ b( boolc( lv_x2 < lv_xs ) ) }|.
    rv = |a:{ lv_r }|.
    lv_xs = '4100425041434B'.
    lv_ys = '504100'.
    lv_r = |{ b( boolc( lv_xs+3(2) = lv_ys ) ) }{ b( boolc( lv_xs+3(2) < lv_ys ) ) }|.
    lv_x2 = '5041'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs+3(2) = lv_x2 ) ) }{ b( boolc( lv_x2 = lv_xs+3(3) ) ) }|.
    rv = |{ rv } b:{ lv_r }|.
    lv_s = 'ab'.
    lv_x1 = 'AB'.
    lv_xs = 'AB'.
    lv_r = |{ b( boolc( lv_x1 = lv_s ) ) }{ b( boolc( lv_xs = lv_s ) ) }{ b( boolc( lv_xs > lv_s ) ) }|.
    lv_s = `AB `.
    lv_r = |{ lv_r }{ b( boolc( lv_x1 = lv_s ) ) }{ b( boolc( lv_xs = lv_s ) ) }{ b( boolc( lv_s = `AB` ) ) }{ b( boolc( `AB` < lv_s ) ) }|.
    lv_s = `AB0`.
    lv_r = |{ lv_r }{ b( boolc( lv_xs < lv_s ) ) }|.
    rv = |{ rv } c:{ lv_r }|.
  ENDMETHOD.

  METHOD str.
    DATA lv_c2 TYPE c LENGTH 2.
    DATA lv_x1 TYPE x LENGTH 1.
    DATA lv_xs TYPE xstring.
    DATA lv_s TYPE string.
    DATA lv_r TYPE string.
    lv_c2 = 'AB'.
    lv_s = `AB `.
    lv_r = |{ b( boolc( lv_c2 = lv_s ) ) }{ b( boolc( lv_c2 = `AB ` ) ) }{ b( boolc( lv_s = 'AB' ) ) }{ b( boolc( lv_s = `AB` ) ) }{ b( boolc( lv_s = 'AB ' ) ) }|.
    lv_xs = 'AB'.
    lv_x1 = 'AB'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = `AB ` ) ) }{ b( boolc( lv_x1 = `AB ` ) ) }{ b( boolc( lv_xs = lv_s ) ) }{ b( boolc( lv_x1 = lv_s ) ) }|.
    lv_xs = '00'.
    lv_x1 = '00'.
    lv_s = `00 `.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = `00 ` ) ) }{ b( boolc( lv_x1 = `00 ` ) ) }{ b( boolc( lv_xs = lv_s ) ) }{ b( boolc( lv_x1 = lv_s ) ) }|.
    lv_s = `AB`.
    lv_xs = 'AB'.
    lv_r = |{ lv_r }{ b( boolc( lv_xs = lv_s ) ) }{ b( boolc( lv_xs = `AB` ) ) }{ b( boolc( lv_xs = 'AB' ) ) }{ b( boolc( lv_xs = 'AB ' ) ) }{ b( boolc( lv_xs = `ab` ) ) }|.
    rv = |s:{ lv_r }|.
  ENDMETHOD.

  METHOD mov.
    DATA lv_x2 TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lv_i TYPE i.
    lv_x2 = 'AB00'.
    lv_xs = lv_x2.
    lv_i = xstrlen( lv_xs ).
    rv = |m:{ lv_xs }/{ lv_i }|.
    lv_x2 = '00AB'.
    lv_xs = '00AB'.
    rv = |{ rv } z:{ b( boolc( lv_x2 = lv_xs ) ) }|.
    lv_x2 = '0000'.
    CLEAR lv_xs.
    rv = |{ rv }{ b( boolc( lv_x2 = lv_xs ) ) }{ b( boolc( lv_xs = lv_x2 ) ) }|.
    lv_xs = '00'.
    rv = |{ rv }{ b( boolc( lv_x2 = lv_xs ) ) }{ b( boolc( lv_xs > lv_x2 ) ) }|.
  ENDMETHOD.
ENDCLASS.
