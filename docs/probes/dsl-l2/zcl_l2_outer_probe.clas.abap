* Probe for DSL L2 slice 5 (docs/dsl-l2.md): what this runtime answers for
* a LEFT OUTER JOIN, the shape a zero count would need in one query.
* Each method returns one line per result row, "ship:crew:since:flag",
* flag I when the crew side came back initial.
CLASS zcl_l2_outer_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             ship_ship_id TYPE zosd_l2_ship-ship_id,
             crew_crew_id TYPE zosd_l2_crew-crew_id,
             crew_since TYPE zosd_l2_crew-since,
           END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    " 1: ON holds the join equality only (legal in 7.02)
    CLASS-METHODS outer_eq RETURNING VALUE(rt_lines) TYPE string_table.
    " 2: ON also holds an equality with a literal (legal: SAP docs show one)
    CLASS-METHODS outer_on_literal RETURNING VALUE(rt_lines) TYPE string_table.
    " 3: ON also holds a > against a host variable (7.02: refused)
    CLASS-METHODS outer_on_greater IMPORTING iv_date TYPE d RETURNING VALUE(rt_lines) TYPE string_table.
    " 4: a field of the right table in WHERE (7.02: refused)
    CLASS-METHODS outer_where_right RETURNING VALUE(rt_lines) TYPE string_table.
    " 5: two queries (for rows, inner join counted by COLLECT), merged in ABAP;
    "    COLLECT does not sum here (see 6), so it is right only at one row per key
    CLASS-METHODS two_queries IMPORTING iv_date TYPE d RETURNING VALUE(rt_lines) TYPE string_table.
    " 6: COLLECT into a sorted table and into a standard table, two rows of one key
    CLASS-METHODS collect_sorted RETURNING VALUE(rt_lines) TYPE string_table.
    CLASS-METHODS collect_standard RETURNING VALUE(rt_lines) TYPE string_table.
  PRIVATE SECTION.
    CLASS-METHODS lines_of IMPORTING it_rows TYPE ty_rows RETURNING VALUE(rt_lines) TYPE string_table.
ENDCLASS.

CLASS zcl_l2_outer_probe IMPLEMENTATION.
  METHOD collect_sorted.
    TYPES: BEGIN OF ty_count,
             key TYPE c LENGTH 4,
             cnt TYPE i,
           END OF ty_count.
    DATA lt_count TYPE SORTED TABLE OF ty_count WITH UNIQUE KEY key.
    DATA ls_count TYPE ty_count.
    DATA lv_count TYPE c LENGTH 12.
    DATA lv_line TYPE string.
    ls_count-key = 'P001'.
    ls_count-cnt = 1.
    COLLECT ls_count INTO lt_count.
    COLLECT ls_count INTO lt_count.
    ls_count-key = 'P000'.
    COLLECT ls_count INTO lt_count.
    LOOP AT lt_count INTO ls_count.
      lv_count = ls_count-cnt.
      CONDENSE lv_count NO-GAPS.
      CONCATENATE ls_count-key lv_count INTO lv_line SEPARATED BY ':'.
      APPEND lv_line TO rt_lines.
    ENDLOOP.
  ENDMETHOD.

  METHOD collect_standard.
    TYPES: BEGIN OF ty_count,
             key TYPE c LENGTH 4,
             cnt TYPE i,
           END OF ty_count.
    DATA lt_count TYPE STANDARD TABLE OF ty_count WITH DEFAULT KEY.
    DATA ls_count TYPE ty_count.
    DATA lv_count TYPE c LENGTH 12.
    DATA lv_line TYPE string.
    ls_count-key = 'P001'.
    ls_count-cnt = 1.
    COLLECT ls_count INTO lt_count.
    COLLECT ls_count INTO lt_count.
    ls_count-key = 'P000'.
    COLLECT ls_count INTO lt_count.
    LOOP AT lt_count INTO ls_count.
      lv_count = ls_count-cnt.
      CONDENSE lv_count NO-GAPS.
      CONCATENATE ls_count-key lv_count INTO lv_line SEPARATED BY ':'.
      APPEND lv_line TO rt_lines.
    ENDLOOP.
  ENDMETHOD.

  METHOD lines_of.
    DATA ls_row TYPE ty_row.
    DATA lv_flag TYPE c LENGTH 1.
    DATA lv_line TYPE string.
    LOOP AT it_rows INTO ls_row.
      CLEAR lv_flag.
      IF ls_row-crew_crew_id IS INITIAL AND ls_row-crew_since IS INITIAL.
        lv_flag = 'I'.
      ENDIF.
      CONCATENATE ls_row-ship_ship_id ls_row-crew_crew_id ls_row-crew_since lv_flag
        INTO lv_line SEPARATED BY ':'.
      APPEND lv_line TO rt_lines.
    ENDLOOP.
  ENDMETHOD.

  METHOD outer_eq.
    DATA lt_rows TYPE ty_rows.
    SELECT ship~ship_id AS ship_ship_id crew~crew_id AS crew_crew_id crew~since AS crew_since
      FROM zosd_l2_ship AS ship
        LEFT OUTER JOIN zosd_l2_crew AS crew
          ON crew~ship_id = ship~ship_id
      INTO CORRESPONDING FIELDS OF TABLE lt_rows
      WHERE ship~ship_id LIKE 'P%'
      ORDER BY ship~ship_id crew~crew_id.
    rt_lines = lines_of( lt_rows ).
  ENDMETHOD.

  METHOD outer_on_literal.
    DATA lt_rows TYPE ty_rows.
    SELECT ship~ship_id AS ship_ship_id crew~crew_id AS crew_crew_id crew~since AS crew_since
      FROM zosd_l2_ship AS ship
        LEFT OUTER JOIN zosd_l2_crew AS crew
          ON crew~ship_id = ship~ship_id
          AND crew~role = 'C'
      INTO CORRESPONDING FIELDS OF TABLE lt_rows
      WHERE ship~ship_id LIKE 'P%'
      ORDER BY ship~ship_id crew~crew_id.
    rt_lines = lines_of( lt_rows ).
  ENDMETHOD.

  METHOD outer_on_greater.
    DATA lt_rows TYPE ty_rows.
    SELECT ship~ship_id AS ship_ship_id crew~crew_id AS crew_crew_id crew~since AS crew_since
      FROM zosd_l2_ship AS ship
        LEFT OUTER JOIN zosd_l2_crew AS crew
          ON crew~ship_id = ship~ship_id
          AND crew~since > iv_date
      INTO CORRESPONDING FIELDS OF TABLE lt_rows
      WHERE ship~ship_id LIKE 'P%'
      ORDER BY ship~ship_id crew~crew_id.
    rt_lines = lines_of( lt_rows ).
  ENDMETHOD.

  METHOD outer_where_right.
    DATA lt_rows TYPE ty_rows.
    SELECT ship~ship_id AS ship_ship_id crew~crew_id AS crew_crew_id crew~since AS crew_since
      FROM zosd_l2_ship AS ship
        LEFT OUTER JOIN zosd_l2_crew AS crew
          ON crew~ship_id = ship~ship_id
      INTO CORRESPONDING FIELDS OF TABLE lt_rows
      WHERE ship~ship_id LIKE 'P%'
        AND crew~role = 'C'
      ORDER BY ship~ship_id crew~crew_id.
    rt_lines = lines_of( lt_rows ).
  ENDMETHOD.

  METHOD two_queries.
    TYPES: BEGIN OF ty_for,
             ship_ship_id TYPE zosd_l2_ship-ship_id,
           END OF ty_for.
    TYPES: BEGIN OF ty_count,
             ship_ship_id TYPE zosd_l2_ship-ship_id,
             cnt TYPE i,
           END OF ty_count.
    DATA lt_for TYPE STANDARD TABLE OF ty_for WITH DEFAULT KEY.
    DATA ls_for TYPE ty_for.
    DATA lt_join TYPE STANDARD TABLE OF ty_for WITH DEFAULT KEY.
    DATA ls_join TYPE ty_for.
    DATA lt_count TYPE SORTED TABLE OF ty_count WITH UNIQUE KEY ship_ship_id.
    DATA ls_count TYPE ty_count.
    DATA lv_count TYPE c LENGTH 12.
    DATA lv_line TYPE string.
    SELECT ship~ship_id AS ship_ship_id
      FROM zosd_l2_ship AS ship
      INTO CORRESPONDING FIELDS OF TABLE lt_for
      WHERE ship~ship_id LIKE 'P%'
      ORDER BY ship~ship_id.
    SELECT ship~ship_id AS ship_ship_id
      FROM zosd_l2_ship AS ship
        INNER JOIN zosd_l2_crew AS crew
          ON crew~ship_id = ship~ship_id
      INTO CORRESPONDING FIELDS OF TABLE lt_join
      WHERE ship~ship_id LIKE 'P%'
        AND crew~since > iv_date.
    LOOP AT lt_join INTO ls_join.
      ls_count-ship_ship_id = ls_join-ship_ship_id.
      ls_count-cnt = 1.
      COLLECT ls_count INTO lt_count.
    ENDLOOP.
    LOOP AT lt_for INTO ls_for.
      CLEAR ls_count.
      READ TABLE lt_count INTO ls_count WITH TABLE KEY ship_ship_id = ls_for-ship_ship_id.
      lv_count = ls_count-cnt.
      CONDENSE lv_count NO-GAPS.
      CONCATENATE ls_for-ship_ship_id lv_count INTO lv_line SEPARATED BY ':'.
      APPEND lv_line TO rt_lines.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
