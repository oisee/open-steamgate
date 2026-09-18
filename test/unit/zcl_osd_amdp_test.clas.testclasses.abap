CLASS ltcl_amdp DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The point of the whole bridge in one assertion: ordinary ABAP calls an
* ordinary method, the body of that method is SQLScript, and it runs in a real
* HANA without the caller knowing. Only in the HANA mode -- everywhere else
* there is nowhere to run an AMDP body, and the test says so rather than
* pretending.
  PRIVATE SECTION.
    METHODS squares_are_computed_in_hana FOR TESTING RAISING cx_static_check.
    METHODS a_table_function_returns_rows FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_amdp IMPLEMENTATION.

  METHOD squares_are_computed_in_hana.
    DATA lt_square TYPE zcl_osd_amdp_demo=>tt_square.
    DATA ls_square TYPE zcl_osd_amdp_demo=>ty_square.

    IF sy-dbsys <> 'HDB'.
      RETURN.
    ENDIF.

    zcl_osd_amdp_demo=>squares( EXPORTING iv_count  = 4
                                IMPORTING et_square = lt_square ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_square )
                                        exp = 4
                                        msg = 'four rows, computed by SQLScript in HANA' ).
    READ TABLE lt_square INDEX 3 INTO ls_square.
    cl_abap_unit_assert=>assert_equals( act = ls_square-square
                                        exp = 9
                                        msg = 'the third square' ).
    cl_abap_unit_assert=>assert_equals( act = ls_square-label
                                        exp = 'square of 3'
                                        msg = 'and the text HANA built' ).
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
