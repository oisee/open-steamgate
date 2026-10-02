"! Ordered JSON object writer; callers append keys in wire order.
CLASS zcl_osd_adt_json DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Parse with IV_KEEP_ITEM_ORDER to retain object insertion order.
    CLASS-METHODS ordered_members
      IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string
      RETURNING VALUE(rt_members) TYPE string_table.
    CLASS-METHODS quote IMPORTING iv_text TYPE string RETURNING VALUE(rv_json) TYPE string.
    METHODS add IMPORTING iv_name TYPE string iv_value TYPE string.
    METHODS add_raw IMPORTING iv_name TYPE string iv_json TYPE string.
    METHODS document RETURNING VALUE(rv_json) TYPE string.
  PRIVATE SECTION.
    DATA mv_members TYPE string.
    DATA mv_count TYPE i.
ENDCLASS.
CLASS zcl_osd_adt_json IMPLEMENTATION.
  METHOD ordered_members.
    DATA lv_path TYPE string.
    DATA ls_node TYPE zif_ajson_types=>ty_node.
    DATA lv_key TYPE string VALUE `item_order`.
    lv_path = iv_path.
    REPLACE ALL OCCURRENCES OF REGEX `^/+|/+$` IN lv_path WITH ``.
    IF lv_path IS NOT INITIAL.
      lv_path = `/` && lv_path.
    ENDIF.
    IF io_json->zif_ajson~get_node_type( lv_path ) = `array`.
      lv_key = `array_index`.
    ENDIF.
    lv_path = lv_path && `/`.
    LOOP AT io_json->mt_json_tree INTO ls_node USING KEY (lv_key) WHERE path = lv_path.
      APPEND ls_node-name TO rt_members.
    ENDLOOP.
  ENDMETHOD.
  METHOD quote.
    DATA lv_char TYPE string.
    DATA lv_bytes TYPE xstring.
    DATA lv_hex TYPE c LENGTH 2.
    DATA lv_off TYPE i.
    rv_json = `"`.
    DO strlen( iv_text ) TIMES.
      lv_off = sy-index - 1.
      lv_char = iv_text+lv_off(1).
      CASE lv_char.
        WHEN `"`.
          lv_char = `\"`.
        WHEN `\`.
          lv_char = `\\`.
        WHEN cl_abap_char_utilities=>newline.
          lv_char = `\n`.
        WHEN cl_abap_char_utilities=>cr_lf(1).
          lv_char = `\r`.
        WHEN cl_abap_char_utilities=>horizontal_tab.
          lv_char = `\t`.
        WHEN cl_abap_char_utilities=>backspace.
          lv_char = `\b`.
        WHEN cl_abap_char_utilities=>form_feed.
          lv_char = `\f`.
        WHEN OTHERS.
          lv_bytes = cl_abap_codepage=>convert_to( lv_char ).
          IF xstrlen( lv_bytes ) = 1 AND lv_bytes < '20'.
            lv_hex = lv_bytes.
            lv_char = `\u00` && to_lower( lv_hex ).
          ENDIF.
      ENDCASE.
      rv_json = rv_json && lv_char.
    ENDDO.
    rv_json = rv_json && `"`.
  ENDMETHOD.
  METHOD add.
    add_raw( iv_name = iv_name iv_json = quote( iv_value ) ).
  ENDMETHOD.
  METHOD add_raw.
    IF mv_count > 0.
      mv_members = mv_members && `,`.
    ENDIF.
    mv_members = mv_members && quote( iv_name ) && `:` && iv_json.
    mv_count = mv_count + 1.
  ENDMETHOD.
  METHOD document.
    rv_json = `{` && mv_members && `}`.
  ENDMETHOD.
ENDCLASS.
