CLASS ltcl_amdp DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The point of the whole bridge in one assertion: ordinary ABAP calls an
* ordinary method and the unchanged SQLScript body runs either natively in
* HANA or through typed portable IR on DuckDB. The ABAP call site is the same.
  PRIVATE SECTION.
    METHODS squares_are_computed FOR TESTING RAISING cx_static_check.
    METHODS open_sql_rows_cross_the_amdp FOR TESTING RAISING cx_static_check.
    METHODS nested_amdp_stays_relational FOR TESTING RAISING cx_static_check.
    METHODS open_sql_luw_is_shared FOR TESTING RAISING cx_static_check.
    METHODS a_table_function_returns_rows FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_amdp IMPLEMENTATION.

  METHOD squares_are_computed.
    DATA lt_square TYPE zcl_osd_amdp_demo=>tt_square.
    DATA ls_square TYPE zcl_osd_amdp_demo=>ty_square.

    IF sy-dbsys <> 'HDB' AND sy-dbsys <> 'duckdb'.
      RETURN.
    ENDIF.

    zcl_osd_amdp_demo=>squares( EXPORTING iv_count  = 4
                                IMPORTING et_square = lt_square ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_square )
                                        exp = 4
                                        msg = 'four rows, computed from the unchanged SQLScript body' ).
    READ TABLE lt_square INDEX 3 INTO ls_square.
    cl_abap_unit_assert=>assert_equals( act = ls_square-square
                                        exp = 9
                                        msg = 'the third square' ).
    cl_abap_unit_assert=>assert_equals( act = ls_square-label
                                        exp = 'square of 3'
                                        msg = 'and the text HANA built' ).
  ENDMETHOD.

  METHOD open_sql_rows_cross_the_amdp.
    DATA lt_amount TYPE zcl_osd_amdp_demo=>tt_amount.
    DATA lt_total TYPE zcl_osd_amdp_demo=>tt_total.
    DATA ls_total TYPE zcl_osd_amdp_demo=>ty_total.
    DATA ls_amount TYPE zcl_osd_amdp_demo=>ty_amount.

    IF sy-dbsys <> 'HDB' AND sy-dbsys <> 'duckdb'.
      RETURN.
    ENDIF.

*   This is deliberately Open SQL at the call site, not a JavaScript fixture.
*   The AMDP receives the typed table through the ordinary method signature.
    SELECT seats AS amount
      INTO CORRESPONDING FIELDS OF TABLE @lt_amount
      FROM zstg_demo
      WHERE status = 'A'.

    zcl_osd_amdp_demo=>total_amount( EXPORTING it_amount = lt_amount
                                     IMPORTING et_total  = lt_total ).

    LOOP AT lt_amount INTO ls_amount.
      ls_total-total = ls_total-total + ls_amount-amount.
    ENDLOOP.
    cl_abap_unit_assert=>assert_equals( act = lines( lt_total ) exp = 1 ).
    READ TABLE lt_total INDEX 1 INTO DATA(ls_actual).
    cl_abap_unit_assert=>assert_equals( act = ls_actual-item_count
                                        exp = lines( lt_amount ) ).
    cl_abap_unit_assert=>assert_equals( act = ls_actual-total
                                        exp = ls_total-total ).

*   Empty is a typed zero-row relation, not an omitted input or an inferred
*   JavaScript array. COUNT and SUM make that distinction observable.
    CLEAR: lt_amount, lt_total, ls_actual.
    zcl_osd_amdp_demo=>total_amount( EXPORTING it_amount = lt_amount
                                     IMPORTING et_total  = lt_total ).
    READ TABLE lt_total INDEX 1 INTO ls_actual.
    cl_abap_unit_assert=>assert_equals( act = ls_actual-item_count exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = ls_actual-total exp = 0 ).
  ENDMETHOD.

  METHOD nested_amdp_stays_relational.
    DATA lt_amount TYPE zcl_osd_amdp_demo=>tt_amount.
    DATA lt_total TYPE zcl_osd_amdp_demo=>tt_total.

    IF sy-dbsys <> 'HDB' AND sy-dbsys <> 'duckdb'.
      RETURN.
    ENDIF.

    APPEND VALUE #( amount = 7 ) TO lt_amount.
    APPEND VALUE #( amount = 11 ) TO lt_amount.
    zcl_osd_amdp_demo=>total_amount_nested(
      EXPORTING it_amount = lt_amount
      IMPORTING et_total  = lt_total ).

    READ TABLE lt_total INDEX 1 INTO DATA(ls_total).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_total ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = ls_total-item_count exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = ls_total-total exp = 18 ).
  ENDMETHOD.

  METHOD open_sql_luw_is_shared.
    DATA ls_row TYPE zstg_demo.
    DATA lt_travel TYPE zcl_osd_amdp_demo=>tt_travel.
    DATA lv_client TYPE string.
    DATA lv_travel_id TYPE string.

*   Native HANA currently uses a deliberately isolated AMDP session, so this
*   test is specifically the portable shared-connection contract.  A COMMIT
*   here would make the test pass for the wrong reason.
    IF sy-dbsys <> 'duckdb'.
      RETURN.
    ENDIF.

    DELETE FROM zstg_demo WHERE travel_id = 'AMDP-LUW'.
    ls_row-mandt = sy-mandt.
    ls_row-travel_id = 'AMDP-LUW'.
    ls_row-description = 'uncommitted Open SQL row'.
    ls_row-status = 'A'.
    ls_row-seats = 37.
    INSERT zstg_demo FROM ls_row.
    lv_client = sy-mandt.
    lv_travel_id = ls_row-travel_id.

    zcl_osd_amdp_demo=>read_travel(
      EXPORTING iv_client = lv_client iv_travel_id = lv_travel_id
      IMPORTING et_travel = lt_travel ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_travel ) exp = 1
      msg = 'portable AMDP must read the caller Open SQL connection without COMMIT' ).
    READ TABLE lt_travel INDEX 1 INTO DATA(ls_actual).
    cl_abap_unit_assert=>assert_equals( act = ls_actual-description exp = ls_row-description ).
    cl_abap_unit_assert=>assert_equals( act = ls_actual-seats exp = 37 ).

    DELETE FROM zstg_demo WHERE travel_id = 'AMDP-LUW'.
  ENDMETHOD.

  METHOD a_table_function_returns_rows.
* The other half of AMDP: a table function, whose result is queryable like a
* view rather than handed to one caller. Here it is called as a method; that
* it can also be selected from is what makes it worth having.
    DATA lt_square TYPE zcl_osd_amdp_demo=>tt_square_tf.
    DATA ls_square TYPE zcl_osd_amdp_demo=>ty_square_tf.

    IF sy-dbsys <> 'HDB'.
      RETURN.
    ENDIF.

    lt_square = zcl_osd_amdp_demo=>squares_tf( 5 ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_square )
                                        exp = 5
                                        msg = 'five rows out of the table function' ).
    READ TABLE lt_square INDEX 4 INTO ls_square.
    cl_abap_unit_assert=>assert_equals( act = ls_square-square
                                        exp = 16
                                        msg = 'the fourth square' ).
  ENDMETHOD.

ENDCLASS.
