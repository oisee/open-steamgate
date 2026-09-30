* The differential test of R1: BEFORE and AFTER run on the same rows over the
* same table contents and must leave the same rows. Each case is one of the
* obligations the recipe declares (docs/verified-lift.md, 3.3): a hit, a miss
* that keeps what the row held, a key asked twice, no rows at all, a key that
* differs in one component only.
CLASS ltcl_r1 DEFINITION FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS hits_and_misses FOR TESTING.
    METHODS a_miss_keeps_the_old_value FOR TESTING.
    METHODS the_same_key_twice FOR TESTING.
    METHODS no_rows FOR TESTING.
    METHODS one_component_differs FOR TESTING.
    METHODS row
      IMPORTING
        iv_kind       TYPE clike
        iv_code       TYPE clike
        iv_text       TYPE clike OPTIONAL
      RETURNING
        VALUE(rs_row) TYPE zcl_osd_lift_r1_demo=>ty_row.
    METHODS text_of
      IMPORTING
        it_rows        TYPE zcl_osd_lift_r1_demo=>tt_rows
        iv_index       TYPE i
      RETURNING
        VALUE(rv_text) TYPE string.
    METHODS same
      IMPORTING
        it_rows TYPE zcl_osd_lift_r1_demo=>tt_rows
      RETURNING
        VALUE(rt_rows) TYPE zcl_osd_lift_r1_demo=>tt_rows.
ENDCLASS.

CLASS ltcl_r1 IMPLEMENTATION.

  METHOD setup.
    DATA lt_db TYPE STANDARD TABLE OF zosd_lift_txt WITH DEFAULT KEY.
    DATA ls_db TYPE zosd_lift_txt.
    DELETE FROM zosd_lift_txt.
    ls_db-mandt = sy-mandt.
    ls_db-kind = 'STAT'.
    ls_db-code = 'OPEN'.
    ls_db-text = 'Open'.
    APPEND ls_db TO lt_db.
    ls_db-code = 'DONE'.
    ls_db-text = 'Done'.
    APPEND ls_db TO lt_db.
    ls_db-kind = 'PRIO'.
    ls_db-code = 'OPEN'.
    ls_db-text = 'Open priority'.
    APPEND ls_db TO lt_db.
    INSERT zosd_lift_txt FROM TABLE lt_db.
  ENDMETHOD.

  METHOD row.
    rs_row-kind = iv_kind.
    rs_row-code = iv_code.
    rs_row-text = iv_text.
  ENDMETHOD.

  METHOD text_of.
    DATA ls_row TYPE zcl_osd_lift_r1_demo=>ty_row.
    READ TABLE it_rows INTO ls_row INDEX iv_index.
    cl_abap_unit_assert=>assert_subrc( ).
    rv_text = ls_row-text.
  ENDMETHOD.

  METHOD same.
    " Runs both and asserts they agree; returns what they agreed on.
    DATA lt_after TYPE zcl_osd_lift_r1_demo=>tt_rows.
    rt_rows = it_rows.
    lt_after = it_rows.
    zcl_osd_lift_r1_demo=>before( CHANGING ct_rows = rt_rows ).
    zcl_osd_lift_r1_demo=>after( CHANGING ct_rows = lt_after ).
    cl_abap_unit_assert=>assert_equals( exp = rt_rows act = lt_after ).
  ENDMETHOD.

  METHOD hits_and_misses.
    DATA lt_rows TYPE zcl_osd_lift_r1_demo=>tt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'GONE' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'DONE' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_equals( exp = 'Open' act = text_of( it_rows = lt_rows iv_index = 1 ) ).
  ENDMETHOD.

  METHOD a_miss_keeps_the_old_value.
    " SELECT SINGLE that finds nothing leaves its target alone; so must AFTER.
    DATA lt_rows TYPE zcl_osd_lift_r1_demo=>tt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'GONE' iv_text = 'kept' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_equals( exp = 'kept' act = text_of( it_rows = lt_rows iv_index = 1 ) ).
  ENDMETHOD.

  METHOD the_same_key_twice.
    DATA lt_rows TYPE zcl_osd_lift_r1_demo=>tt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' ) TO lt_rows.
    APPEND row( iv_kind = 'STAT' iv_code = 'OPEN' iv_text = 'stale' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_equals( exp = 'Open' act = text_of( it_rows = lt_rows iv_index = 2 ) ).
  ENDMETHOD.

  METHOD no_rows.
    " FOR ALL ENTRIES over an empty table selects everything; AFTER guards it.
    DATA lt_rows TYPE zcl_osd_lift_r1_demo=>tt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_initial( lt_rows ).
  ENDMETHOD.

  METHOD one_component_differs.
    DATA lt_rows TYPE zcl_osd_lift_r1_demo=>tt_rows.
    APPEND row( iv_kind = 'PRIO' iv_code = 'OPEN' ) TO lt_rows.
    APPEND row( iv_kind = 'PRIO' iv_code = 'DONE' ) TO lt_rows.
    lt_rows = same( lt_rows ).
    cl_abap_unit_assert=>assert_equals( exp = 'Open priority' act = text_of( it_rows = lt_rows iv_index = 1 ) ).
    cl_abap_unit_assert=>assert_initial( text_of( it_rows = lt_rows iv_index = 2 ) ).
  ENDMETHOD.

ENDCLASS.
