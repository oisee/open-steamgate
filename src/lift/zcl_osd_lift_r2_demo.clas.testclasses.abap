* Differential test of the R2 lift: BEFORE runs a SELECT INTO TABLE for each
* row; AFTER fetches once and rebuilds the same result table in primary-key
* order. The fixture owns its synthetic table rows and restores them.
CLASS ltcl_r2 DEFINITION FOR TESTING
  RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    DATA mt_saved TYPE STANDARD TABLE OF zosd_lift_r2 WITH DEFAULT KEY.
    METHODS setup.
    METHODS teardown.
    METHODS hits_misses_and_filter FOR TESTING.
    METHODS the_same_key_twice FOR TESTING.
    METHODS no_rows FOR TESTING.
    METHODS row
      IMPORTING
        iv_kind       TYPE clike
        iv_code       TYPE clike
        iv_result     TYPE clike OPTIONAL
      RETURNING
        VALUE(rs_row) TYPE zcl_osd_lift_r2_demo=>ty_row.
    METHODS same
      IMPORTING
        it_rows       TYPE zcl_osd_lift_r2_demo=>tt_rows
      RETURNING
        VALUE(rt_rows) TYPE zcl_osd_lift_r2_demo=>tt_rows.
ENDCLASS.

CLASS ltcl_r2 IMPLEMENTATION.

  METHOD setup.
    DATA lt_db TYPE STANDARD TABLE OF zosd_lift_r2 WITH DEFAULT KEY.
    DATA ls_db TYPE zosd_lift_r2.
    SELECT * FROM zosd_lift_r2 INTO TABLE mt_saved WHERE kind = 'STAT' OR kind = 'PRIO'.
    DELETE FROM zosd_lift_r2 WHERE kind = 'STAT' OR kind = 'PRIO'.
    ls_db-kind = 'STAT'.
    ls_db-code = 'OPEN'.
    ls_db-seq = '001'.
    ls_db-active = 'X'.
    ls_db-label = 'First'.
    APPEND ls_db TO lt_db.
    ls_db-seq = '002'.
    ls_db-label = 'Second'.
    APPEND ls_db TO lt_db.
    ls_db-seq = '003'.
    ls_db-active = space.
    ls_db-label = 'Hidden'.
    APPEND ls_db TO lt_db.
    ls_db-seq = '004'.
    ls_db-active = 'X'.
    ls_db-label = 'Second'.
    APPEND ls_db TO lt_db.
    ls_db-code = 'DONE'.
    ls_db-seq = '001'.
    ls_db-active = 'X'.
    ls_db-label = 'Done'.
    APPEND ls_db TO lt_db.
    ls_db-kind = 'PRIO'.
    ls_db-code = 'OPEN'.
    ls_db-label = 'Priority'.
    APPEND ls_db TO lt_db.
    ls_db-seq = '002'.
    ls_db-active = space.
    ls_db-label = 'Hidden priority'.
    APPEND ls_db TO lt_db.
    INSERT zosd_lift_r2 FROM TABLE lt_db.
  ENDMETHOD.

  METHOD teardown.
    DELETE FROM zosd_lift_r2 WHERE kind = 'STAT' OR kind = 'PRIO'.
    IF mt_saved IS NOT INITIAL.
      INSERT zosd_lift_r2 FROM TABLE mt_saved.
    ENDIF.
  ENDMETHOD.

  METHOD row.
    rs_row-kind = iv_kind.
    rs_row-code = iv_code.
    rs_row-result = iv_result.
  ENDMETHOD.

  METHOD same.
    DATA lt_after TYPE zcl_osd_lift_r2_demo=>tt_rows.
    rt_rows = it_rows.
    lt_after = it_rows.
    zcl_osd_lift_r2_demo=>before( CHANGING ct_rows = rt_rows ).
    zcl_osd_lift_r2_demo=>after( CHANGING ct_rows = lt_after ).
    cl_abap_unit_assert=>assert_equals( exp = rt_rows act = lt_after ).
  ENDMETHOD.

  METHOD hits_misses_and_filter.
    DATA lt_rows TYPE zcl_osd_lift_r2_demo=>tt_rows.
    DATA ls_row TYPE zcl_osd_lift_r2_demo=>ty_row.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'GONE' iv_result = 'old' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'DONE' ) TO lt_rows.
    APPEND row( iv_kind = 'PRIO' iv_code = 'OPEN' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    READ TABLE lt_rows INTO ls_row INDEX 1.
    cl_abap_unit_assert=>assert_equals( exp = 'First;Second;Second' act = ls_row-result ).
    cl_abap_unit_assert=>assert_equals( exp = 0 act = ls_row-status ).
    cl_abap_unit_assert=>assert_equals( exp = 3 act = ls_row-db_count ).
    READ TABLE lt_rows INTO ls_row INDEX 2.
    cl_abap_unit_assert=>assert_initial( ls_row-result ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = ls_row-status ).
    cl_abap_unit_assert=>assert_equals( exp = 0 act = ls_row-db_count ).
    READ TABLE lt_rows INTO ls_row INDEX 3.
    cl_abap_unit_assert=>assert_equals( exp = 'Done' act = ls_row-result ).
    READ TABLE lt_rows INTO ls_row INDEX 4.
    cl_abap_unit_assert=>assert_equals( exp = 'Priority' act = ls_row-result ).
    cl_abap_unit_assert=>assert_differs( exp = 'Hidden' act = ls_row-result ).
  ENDMETHOD.

  METHOD the_same_key_twice.
    DATA lt_rows TYPE zcl_osd_lift_r2_demo=>tt_rows.
    DATA ls_row TYPE zcl_osd_lift_r2_demo=>ty_row.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    READ TABLE lt_rows INTO ls_row INDEX 1.
    cl_abap_unit_assert=>assert_equals( exp = 'First;Second;Second' act = ls_row-result ).
    READ TABLE lt_rows INTO ls_row INDEX 2.
    cl_abap_unit_assert=>assert_equals( exp = 'First;Second;Second' act = ls_row-result ).
  ENDMETHOD.

  METHOD no_rows.
    DATA lt_rows TYPE zcl_osd_lift_r2_demo=>tt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_initial( lt_rows ).
  ENDMETHOD.

ENDCLASS.
