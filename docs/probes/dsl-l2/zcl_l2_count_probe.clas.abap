CLASS zcl_l2_count_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS check RETURNING VALUE(rt_counts) TYPE string_table.
ENDCLASS.
CLASS zcl_l2_count_probe IMPLEMENTATION.
  METHOD check.
    TYPES: BEGIN OF ty_row,
             ship_ship_id TYPE zosd_l2_ship-ship_id,
             cnt TYPE i,
           END OF ty_row.
    DATA lt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA ls_row TYPE ty_row.
    DATA lv_count TYPE c LENGTH 12.
    DATA lv_text TYPE string.
    SELECT a~ship_id AS ship_ship_id COUNT( * ) AS cnt
      FROM zosd_l2_ship AS a INNER JOIN zosd_l2_voy AS b
        ON b~ship_id = a~ship_id
      INTO CORRESPONDING FIELDS OF TABLE lt_rows
      GROUP BY a~ship_id
      HAVING COUNT( * ) > 2
      ORDER BY a~ship_id.
    LOOP AT lt_rows INTO ls_row.
      lv_count = ls_row-cnt.
      CONDENSE lv_count NO-GAPS.
      CONCATENATE ls_row-ship_ship_id lv_count INTO lv_text SEPARATED BY ':'.
      APPEND lv_text TO rt_counts.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
