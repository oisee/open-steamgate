CLASS ltcl_luw DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* What a buffer has to get right is not collecting changes -- it is collapsing
* two changes to the same row. Each case below is one that would be wrong if
* the buffer simply appended.
  PRIVATE SECTION.
    DATA mi_luw TYPE REF TO zif_osd_luw.

    METHODS setup.
    METHODS a_change_is_held FOR TESTING RAISING cx_static_check.
    METHODS create_then_update_is_a_create FOR TESTING RAISING cx_static_check.
    METHODS create_then_delete_is_nothing FOR TESTING RAISING cx_static_check.
    METHODS update_then_delete_is_a_delete FOR TESTING RAISING cx_static_check.
    METHODS delete_then_create_is_update FOR TESTING RAISING cx_static_check.
    METHODS other_keys_are_untouched FOR TESTING RAISING cx_static_check.
    METHODS a_delete_keeps_no_row FOR TESTING RAISING cx_static_check.
    METHODS discard_forgets_everything FOR TESTING RAISING cx_static_check.

    METHODS row
      IMPORTING iv_text       TYPE string
      RETURNING VALUE(rr_row) TYPE REF TO data.
ENDCLASS.

CLASS ltcl_luw IMPLEMENTATION.

  METHOD setup.
    CREATE OBJECT mi_luw TYPE zcl_osd_luw.
  ENDMETHOD.

  METHOD row.
    DATA lv_text TYPE string.
    lv_text = iv_text.
    GET REFERENCE OF lv_text INTO rr_row.
  ENDMETHOD.

  METHOD a_change_is_held.
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = row( 'first' ) ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' )
      exp = 'C'
      msg = 'the buffer says what it knows about the row' ).
  ENDMETHOD.

  METHOD create_then_update_is_a_create.
* a row created in this LUW and then changed is still a row to create, with
* the later content -- saving it as an update would find nothing to update
    DATA lr_row TYPE REF TO data.
    FIELD-SYMBOLS <lv_text> TYPE string.

    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = row( 'first' ) ).
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'U' ir_row = row( 'second' ) ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 1 msg = 'one row, one change' ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' ) exp = 'C' ).
    lr_row = mi_luw->row_of( iv_entity = 'Travel' iv_key = 'T1' ).
    ASSIGN lr_row->* TO <lv_text>.
    cl_abap_unit_assert=>assert_equals( act = <lv_text> exp = 'second' msg = 'and the later content' ).
  ENDMETHOD.

  METHOD create_then_delete_is_nothing.
* a row that was created here and deleted here never existed
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = row( 'first' ) ).
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'D' ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 0
                                        msg = 'nothing is left to save' ).
    cl_abap_unit_assert=>assert_initial( act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' )
                                         msg = 'and the buffer says nothing about it' ).
  ENDMETHOD.

  METHOD update_then_delete_is_a_delete.
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'U' ir_row = row( 'changed' ) ).
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'D' ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' ) exp = 'D' ).
  ENDMETHOD.

  METHOD delete_then_create_is_update.
* the one that is easy to get wrong: this is not two changes, it is a row that
* ends up present and different. Replaying both would delete what was just
* written.
    DATA lr_row TYPE REF TO data.
    FIELD-SYMBOLS <lv_text> TYPE string.

    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'D' ).
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = row( 'reborn' ) ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' ) exp = 'U'
      msg = 'delete then create is an update' ).
    lr_row = mi_luw->row_of( iv_entity = 'Travel' iv_key = 'T1' ).
    ASSIGN lr_row->* TO <lv_text>.
    cl_abap_unit_assert=>assert_equals( act = <lv_text> exp = 'reborn' ).
  ENDMETHOD.

  METHOD other_keys_are_untouched.
    mi_luw->modify( iv_entity = 'Travel'  iv_key = 'T1' iv_operation = 'C' ir_row = row( 'one' ) ).
    mi_luw->modify( iv_entity = 'Travel'  iv_key = 'T2' iv_operation = 'U' ir_row = row( 'two' ) ).
    mi_luw->modify( iv_entity = 'Booking' iv_key = 'T1' iv_operation = 'D' ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 3
                                        msg = 'the same key under another entity is another row' ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Booking' iv_key = 'T1' ) exp = 'D' ).
    cl_abap_unit_assert=>assert_equals(
      act = mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' ) exp = 'C' ).
  ENDMETHOD.

  METHOD a_delete_keeps_no_row.
* a delete carries no content, and an update that becomes a delete must not
* keep the row it used to carry
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'U' ir_row = row( 'changed' ) ).
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'D' ).

    cl_abap_unit_assert=>assert_bound(
      act = mi_luw->row_of( iv_entity = 'Travel' iv_key = 'T1' )
      msg = 'the row is still there to be read, which a save sequence may want' ).
  ENDMETHOD.

  METHOD discard_forgets_everything.
    mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = row( 'one' ) ).
    mi_luw->discard( ).

    cl_abap_unit_assert=>assert_equals( act = mi_luw->count( ) exp = 0 ).
  ENDMETHOD.

ENDCLASS.
