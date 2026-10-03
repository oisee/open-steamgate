CLASS zcl_osd_c5_values DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_c5_values IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TYPES: BEGIN OF ty_row, label TYPE string, amount TYPE i, END OF ty_row.
    DATA ls_row TYPE ty_row.
    DATA lt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    ls_row-label = 'example'.
    ls_row-amount = 7.
    APPEND ls_row TO lt_rows.
    out->write( ls_row ).
    out->write( lt_rows ).
  ENDMETHOD.
ENDCLASS.
