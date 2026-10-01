* Probe for DSL L2 slice 6: native SUM / MAX SELECT support, and packed-to-text
* conversion without concatenating a packed operand.
CLASS zcl_l2_aggregate_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_result,
             ship_id TYPE zosd_l2_cargo-ship_id,
             total TYPE zosd_l2_cargo-weight,
             largest TYPE zosd_l2_cargo-weight,
           END OF ty_result.
    TYPES ty_results TYPE STANDARD TABLE OF ty_result WITH DEFAULT KEY.
    CLASS-METHODS aggregate RETURNING VALUE(rt_rows) TYPE ty_results.
    CLASS-METHODS packed_text RETURNING VALUE(rt_text) TYPE string_table.
ENDCLASS.

CLASS zcl_l2_aggregate_probe IMPLEMENTATION.
  METHOD aggregate.
    SELECT ship_id AS ship_id SUM( weight ) AS total MAX( weight ) AS largest
      FROM zosd_l2_cargo
      INTO CORRESPONDING FIELDS OF TABLE rt_rows
      GROUP BY ship_id
      ORDER BY ship_id.
  ENDMETHOD.

  METHOD packed_text.
    DATA lv_packed TYPE p LENGTH 16 DECIMALS 2.
    DATA lv_char TYPE c LENGTH 20.
    DATA lv_text TYPE string.
    lv_packed = '10.50'.
    lv_text = lv_packed.
    CONDENSE lv_text NO-GAPS.
    APPEND lv_text TO rt_text.
    lv_char = lv_packed.
    CONDENSE lv_char NO-GAPS.
    APPEND lv_char TO rt_text.
    lv_packed = '-10.50'.
    lv_text = lv_packed.
    CONDENSE lv_text NO-GAPS.
    APPEND lv_text TO rt_text.
    lv_char = lv_packed.
    CONDENSE lv_char NO-GAPS.
    APPEND lv_char TO rt_text.
  ENDMETHOD.

ENDCLASS.
