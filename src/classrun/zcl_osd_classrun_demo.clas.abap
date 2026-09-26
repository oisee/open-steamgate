CLASS zcl_osd_classrun_demo DEFINITION PUBLIC CREATE PUBLIC.
* A tracked fixture for the classrun route (Q6b, tools/adt-facade.mjs
* "oo/classrun") and its tests: one scalar WRITE and one small table, so
* the route test and the live smoke both have real formatted output to
* check without writing ABAP through the facade first.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_osd_classrun_demo IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    TYPES: BEGIN OF ty_row,
             id   TYPE i,
             name TYPE string,
           END OF ty_row.
    DATA lt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    DATA ls_row TYPE ty_row.

    out->write( 'hello from classrun' ).

    ls_row-id = 1.
    ls_row-name = 'first'.
    APPEND ls_row TO lt_rows.
    ls_row-id = 2.
    ls_row-name = 'second'.
    APPEND ls_row TO lt_rows.
    out->write( lt_rows ).
  ENDMETHOD.

ENDCLASS.
