REPORT zosd_test_demo_prog.

* A program with the four things a program is expected to have: a local
* class, an event block, a subroutine, and an include it reaches.

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
DATA gv_text TYPE string.

START-OF-SELECTION.
  PERFORM count_items CHANGING gv_total.
* describe_total lives in the include, which is the point of it being here
  PERFORM describe_total USING gv_total CHANGING gv_text.
  WRITE: / 'ZOSD_TEST demo items, total quantity:', gv_text.

FORM count_items CHANGING cv_total TYPE i.

  DATA lt_items TYPE zosd_test_item_t.
  DATA ls_item TYPE zosd_test_item.
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

* A program's own local test class, the same as a class's -- proof for the
* VS Code Test Explorer (docs/vscode-extension.md, "Test Explorer groups")
* that a PROG with FOR TESTING is found and runs through the same route
* CLAS already does (tools/adt-facade.mjs core/http/unit/object, type=PROG).
CLASS ltcl_zosd_test_demo_prog DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS counter_adds FOR TESTING.

ENDCLASS.

CLASS ltcl_zosd_test_demo_prog IMPLEMENTATION.

  METHOD counter_adds.
    DATA lo_counter TYPE REF TO lcl_counter.

    CREATE OBJECT lo_counter.
    lo_counter->add( iv_value = 3 ).
    lo_counter->add( iv_value = 4 ).
    cl_abap_unit_assert=>assert_equals(
      act = lo_counter->total( )
      exp = 7 ).
  ENDMETHOD.

ENDCLASS.

INCLUDE zosd_test_demo_inc.
