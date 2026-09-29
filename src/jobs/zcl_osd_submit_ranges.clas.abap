CLASS zcl_osd_submit_ranges DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
* SUBMIT ... WITH sel IN range, lowered by tools/osd-narrow-submit.mjs:
* the caller's range table, whatever its LOW/HIGH type, becomes the
* string ranges the selection screen host reads. A table without
* SIGN/OPTION/LOW/HIGH is a syntax error on a system, so here it is a dump
* and never an empty range, which would select everything.
    CLASS-METHODS of
      IMPORTING
        it_range         TYPE ANY TABLE
      RETURNING
        VALUE(rt_ranges) TYPE zif_gg_selection_screen_types=>ty_ranges.
ENDCLASS.



CLASS zcl_osd_submit_ranges IMPLEMENTATION.

  METHOD of.
    FIELD-SYMBOLS <ls_row> TYPE any.
    FIELD-SYMBOLS <lv_sign> TYPE any.
    FIELD-SYMBOLS <lv_option> TYPE any.
    FIELD-SYMBOLS <lv_low> TYPE any.
    FIELD-SYMBOLS <lv_high> TYPE any.
    DATA ls_range LIKE LINE OF rt_ranges.

    LOOP AT it_range ASSIGNING <ls_row>.
      ASSIGN COMPONENT 'SIGN' OF STRUCTURE <ls_row> TO <lv_sign>.
      ASSERT sy-subrc = 0.
      ASSIGN COMPONENT 'OPTION' OF STRUCTURE <ls_row> TO <lv_option>.
      ASSERT sy-subrc = 0.
      ASSIGN COMPONENT 'LOW' OF STRUCTURE <ls_row> TO <lv_low>.
      ASSERT sy-subrc = 0.
      ASSIGN COMPONENT 'HIGH' OF STRUCTURE <ls_row> TO <lv_high>.
      ASSERT sy-subrc = 0.
      CLEAR ls_range.
      ls_range-sign = <lv_sign>.
      ls_range-option = <lv_option>.
      ls_range-low = <lv_low>.
      ls_range-high = <lv_high>.
      APPEND ls_range TO rt_ranges.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
