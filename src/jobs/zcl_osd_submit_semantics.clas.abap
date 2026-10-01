CLASS zcl_osd_submit_semantics DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_input_rows TYPE STANDARD TABLE OF zif_gg_selection_screen_types=>ty_value
      WITH DEFAULT KEY.
    CLASS-METHODS combine
      IMPORTING it_rows TYPE ty_input_rows
      RETURNING VALUE(rt_values) TYPE zif_gg_selection_screen_types=>ty_values.
    CLASS-METHODS value
      IMPORTING iv_value TYPE string
                is_type TYPE zif_gg_selection_screen_types=>ty_data_type
                iv_lower_case TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS parameter
      IMPORTING is_parameter TYPE zif_gg_selection_screen_types=>ty_parameter
      RETURNING VALUE(rs_parameter) TYPE zif_gg_selection_screen_types=>ty_parameter.
    CLASS-METHODS select_option
      IMPORTING is_option TYPE zif_gg_selection_screen_types=>ty_select_option
      RETURNING VALUE(rs_option) TYPE zif_gg_selection_screen_types=>ty_select_option.
ENDCLASS.

CLASS zcl_osd_submit_semantics IMPLEMENTATION.
  METHOD combine.
    LOOP AT it_rows INTO DATA(ls_row).
      IF NOT line_exists( rt_values[ name = ls_row-name ] ).
        INSERT ls_row INTO TABLE rt_values.
        CONTINUE.
      ENDIF.
      ASSIGN rt_values[ name = ls_row-name ] TO FIELD-SYMBOL(<ls_value>).
      IF <ls_value>-ranges IS INITIAL.
        APPEND VALUE #( sign = 'I' option = 'EQ' low = <ls_value>-value ) TO <ls_value>-ranges.
      ENDIF.
      IF ls_row-ranges IS INITIAL.
        APPEND VALUE #( sign = 'I' option = 'EQ' low = ls_row-value ) TO <ls_value>-ranges.
      ELSE.
        APPEND LINES OF ls_row-ranges TO <ls_value>-ranges.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD value.
    rv_value = iv_value.
    CASE is_type-typ.
      WHEN 'I'.
        rv_value = CONV string( CONV i( iv_value ) ).
      WHEN 'N'.
        IF is_type-length > 0.
          rv_value = |{ CONV i( iv_value ) WIDTH = is_type-length ALIGN = RIGHT PAD = '0' }|.
        ENDIF.
      WHEN 'C'.
        IF is_type-length > 0 AND strlen( rv_value ) > is_type-length.
          rv_value = rv_value(is_type-length).
        ENDIF.
    ENDCASE.
    IF iv_lower_case = abap_false AND ( is_type-typ = 'C' OR is_type-typ = 'STRING' ).
      TRANSLATE rv_value TO UPPER CASE.
    ENDIF.
  ENDMETHOD.

  METHOD parameter.
    rs_parameter = is_parameter.
    IF is_parameter-default IS NOT INITIAL.
      rs_parameter-default = value(
        iv_value = is_parameter-default
        is_type = is_parameter-data_type
        iv_lower_case = is_parameter-lower_case ).
    ENDIF.
  ENDMETHOD.

  METHOD select_option.
    rs_option = is_option.
    IF rs_option-default-sign IS NOT INITIAL.
      rs_option-default-low = value(
        iv_value = is_option-default-low
        is_type = is_option-data_type
        iv_lower_case = is_option-lower_case ).
      IF rs_option-default-high IS NOT INITIAL.
        rs_option-default-high = value(
          iv_value = is_option-default-high
          is_type = is_option-data_type
          iv_lower_case = is_option-lower_case ).
      ENDIF.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
