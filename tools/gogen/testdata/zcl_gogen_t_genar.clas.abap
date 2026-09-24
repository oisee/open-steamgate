* Arithmetic with a generic operand (TYPE any) or a generic target: the
* calculation type is decided by the type the field symbol has at run time,
* as if it had been declared with it (A4H 2026-09-24, $ZOSG_TMP_0400).
* / 2 * 2 tells i from p: 7 / 2 * 2 is 8 in i and 7 in p
CLASS zcl_gogen_t_genar DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_genar IMPLEMENTATION.
  METHOD run.
    CONSTANTS lc_ten TYPE i VALUE 10.
    DATA lv_i TYPE i VALUE 7.
    DATA lv_i8 TYPE int8 VALUE 7.
    DATA lv_p TYPE p LENGTH 8 DECIMALS 2 VALUE '7.50'.
    DATA lv_c TYPE c LENGTH 4 VALUE '7'.
    DATA lv_s TYPE string VALUE `7`.
    DATA lv_n TYPE n LENGTH 3 VALUE '007'.
    DATA lv_f TYPE f VALUE '7.5'.
    DATA lv_r TYPE i.
    DATA lv_rp TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_ti TYPE i.
    DATA lv_tp TYPE p LENGTH 8 DECIMALS 2.
    FIELD-SYMBOLS <a> TYPE any.
    FIELD-SYMBOLS <t> TYPE any.
    ASSIGN lv_i TO <a>.
    lv_r = <a> / 2 * 2.
    rv = |i:{ lv_r }|.
    lv_r = <a> * 100 / lc_ten.
    rv = rv && |,{ lv_r }|.
    lv_rp = <a> / 2 * 2.
    rv = rv && |,{ lv_rp }|.
    ASSIGN lv_i8 TO <a>.
    lv_r = <a> / 2 * 2.
    rv = rv && | i8:{ lv_r }|.
    ASSIGN lv_p TO <a>.
    lv_r = <a> / 2 * 2.
    lv_rp = <a> / 4.
    rv = rv && | p:{ lv_r },{ lv_rp }|.
    ASSIGN lv_c TO <a>.
    lv_r = <a> / 2 * 2.
    rv = rv && | c:{ lv_r }|.
    ASSIGN lv_s TO <a>.
    lv_r = <a> / 2 * 2.
    rv = rv && | s:{ lv_r }|.
    ASSIGN lv_n TO <a>.
    lv_r = <a> / 2 * 2.
    rv = rv && | n:{ lv_r }|.
    ASSIGN lv_f TO <a>.
    lv_r = <a> / 2 * 2.
    rv = rv && | f:{ lv_r }|.
    ASSIGN lv_ti TO <t>.
    <t> = lv_i / 2 * 2.
    rv = rv && | ti:{ lv_ti }|.
    ASSIGN lv_i TO <a>.
    <t> = <a> - 10.
    rv = rv && |,{ lv_ti }|.
    ASSIGN lv_tp TO <t>.
    <t> = lv_i / 2 * 2.
    rv = rv && | tp:{ lv_tp }|.
    <t> = <a> / 4.
    rv = rv && |,{ lv_tp }|.
  ENDMETHOD.
ENDCLASS.
