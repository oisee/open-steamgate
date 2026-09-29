* WIDTH = n PAD = 'x' in a string template, the pad character '=' among
* them (A4H 2026-09-24, $ZOSG_TMP_0400)
CLASS zcl_gogen_t_tplpad DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_tplpad IMPLEMENTATION.
  METHOD run.
    DATA lv_s TYPE string VALUE `zcl_x`.
    DATA lv_c TYPE c LENGTH 8 VALUE 'ab'.
    rv = |{ lv_s WIDTH = 10 PAD = '=' }CP|
      && |/{ lv_s WIDTH = 3 PAD = '=' }|
      && |/{ lv_c WIDTH = 5 PAD = '.' }|
      && |/{ lv_s WIDTH = 8 ALIGN = RIGHT PAD = '0' }|
      && |/{ lv_s PAD = '=' WIDTH = 7 }|.
  ENDMETHOD.
ENDCLASS.
