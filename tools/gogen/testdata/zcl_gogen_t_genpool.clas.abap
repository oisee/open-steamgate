CLASS zcl_gogen_t_genpool DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_genpool IMPLEMENTATION.
  METHOD run.
    DATA lt_src TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_prog TYPE c LENGTH 40.
    DATA lv_msg TYPE string.
    DATA lv_line TYPE i.
    DATA lv_word TYPE string.
    DATA lv_msgid TYPE string.
    DATA lv_offset TYPE i.
    lv_prog = 'UNSET'.
    lv_msg = 'UNSET'.
    lv_line = 99.
    lv_word = 'UNSET'.
    lv_msgid = 'ID'.
    lv_offset = 5.
    sy-subrc = 99.
    APPEND `PROGRAM.` TO lt_src.
    GENERATE SUBROUTINE POOL lt_src NAME lv_prog MESSAGE lv_msg LINE lv_line WORD lv_word
      MESSAGE-ID lv_msgid OFFSET lv_offset.
    rv = |{ sy-subrc }:{ lv_prog }:{ lv_msg }:{ lv_line }:{ lv_word }:{ lv_msgid }:{ lv_offset }|.
  ENDMETHOD.
ENDCLASS.
