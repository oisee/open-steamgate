REPORT ztest_demo_prog.

* A program with the three things a program is expected to have: a local
* class, an event block, and a subroutine.

CLASS lcl_counter DEFINITION FINAL.

  PUBLIC SECTION.
    METHODS add
      IMPORTING
        iv_value TYPE i.
    METHODS total
      RETURNING
        VALUE(rv_total) TYPE i.

  PRIVATE SECTION.
    DATA mv_total TYPE i.

ENDCLASS.

CLASS lcl_counter IMPLEMENTATION.

  METHOD add.
    mv_total = mv_total + iv_value.
  ENDMETHOD.

  METHOD total.
    rv_total = mv_total.
  ENDMETHOD.

ENDCLASS.

DATA gv_total TYPE i.

START-OF-SELECTION.
  PERFORM count_items CHANGING gv_total.
  WRITE: / 'ZTEST demo items, total quantity:', gv_total.

FORM count_items CHANGING cv_total TYPE i.

  DATA lt_items TYPE ztest_item_t.
  DATA ls_item TYPE ztest_item.
  DATA lo_counter TYPE REF TO lcl_counter.

  CREATE OBJECT lo_counter.

  ls_item-item_id = 'I0001'.
  ls_item-quantity = 3.
  APPEND ls_item TO lt_items.

  ls_item-item_id = 'I0002'.
  ls_item-quantity = 4.
  APPEND ls_item TO lt_items.

  LOOP AT lt_items INTO ls_item.
    lo_counter->add( iv_value = ls_item-quantity ).
  ENDLOOP.

  cv_total = lo_counter->total( ).

ENDFORM.
