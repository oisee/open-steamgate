CLASS zcl_osd_submit_ranges DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
* SUBMIT ... WITH sel IN range, lowered by tools/osd-narrow-submit.mjs:
* the caller's range table, whatever its LOW/HIGH type, becomes the
* string ranges the selection screen host reads. A table whose line type
* lacks SIGN/OPTION/LOW/HIGH is a syntax error on a system; here it raises
* ZCX_OSD_SUBMIT -- checked on the type, so an EMPTY table of the wrong type
* is refused too, and never becomes an empty range that admits everything.
    CLASS-METHODS of
      IMPORTING
        it_range         TYPE ANY TABLE
      RETURNING
        VALUE(rt_ranges) TYPE zif_gg_selection_screen_types=>ty_ranges.
    CLASS-METHODS for_submit
      IMPORTING it_range TYPE ANY TABLE
      RETURNING VALUE(rt_ranges) TYPE zif_gg_selection_screen_types=>ty_ranges.
  PRIVATE SECTION.
    CLASS-METHODS check_line_type
      IMPORTING
        it_range TYPE ANY TABLE.
ENDCLASS.



CLASS zcl_osd_submit_ranges IMPLEMENTATION.

  METHOD check_line_type.
    DATA lo_table TYPE REF TO cl_abap_tabledescr.
    DATA lo_line TYPE REF TO cl_abap_datadescr.
    DATA lo_struct TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE cl_abap_structdescr=>component_table.
    DATA lv_name TYPE string.
    DATA lt_names TYPE STANDARD TABLE OF string WITH DEFAULT KEY.

    lo_table ?= cl_abap_typedescr=>describe_by_data( it_range ).
    lo_line = lo_table->get_table_line_type( ).
    IF lo_line->kind <> cl_abap_typedescr=>kind_struct.
      RAISE EXCEPTION TYPE zcx_osd_submit
        EXPORTING iv_detail = `SUBMIT WITH ... IN: the range operand is not a range table`.
    ENDIF.
    lo_struct ?= lo_line.
    lt_components = lo_struct->get_components( ).
    APPEND 'SIGN' TO lt_names.
    APPEND 'OPTION' TO lt_names.
    APPEND 'LOW' TO lt_names.
    APPEND 'HIGH' TO lt_names.
    LOOP AT lt_names INTO lv_name.
      READ TABLE lt_components WITH KEY name = lv_name TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        RAISE EXCEPTION TYPE zcx_osd_submit
          EXPORTING iv_detail = |SUBMIT WITH ... IN: the range operand has no { lv_name } column|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD of.
    FIELD-SYMBOLS <ls_row> TYPE any.
    FIELD-SYMBOLS <lv_sign> TYPE any.
    FIELD-SYMBOLS <lv_option> TYPE any.
    FIELD-SYMBOLS <lv_low> TYPE any.
    FIELD-SYMBOLS <lv_high> TYPE any.
    DATA ls_range LIKE LINE OF rt_ranges.

    check_line_type( it_range ).

    LOOP AT it_range ASSIGNING <ls_row>.
      ASSIGN COMPONENT 'SIGN' OF STRUCTURE <ls_row> TO <lv_sign>.
      ASSIGN COMPONENT 'OPTION' OF STRUCTURE <ls_row> TO <lv_option>.
      ASSIGN COMPONENT 'LOW' OF STRUCTURE <ls_row> TO <lv_low>.
      ASSIGN COMPONENT 'HIGH' OF STRUCTURE <ls_row> TO <lv_high>.
      CLEAR ls_range.
      ls_range-sign = <lv_sign>.
      ls_range-option = <lv_option>.
      ls_range-low = <lv_low>.
      ls_range-high = <lv_high>.
      APPEND ls_range TO rt_ranges.
    ENDLOOP.
  ENDMETHOD.

  METHOD for_submit.
    rt_ranges = of( it_range ).
    IF rt_ranges IS INITIAL.
* Keep an empty IN distinct from a scalar WITH = '' until the registry.
* A range row with this sign is invalid input, so it cannot denote a real
* selection. The registry removes it before calling the report host.
      APPEND VALUE #( sign = '#' option = '  ' ) TO rt_ranges.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
