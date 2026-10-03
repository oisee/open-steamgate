CLASS zcl_osd_c5_firstdump DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_c5_firstdump IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_zero TYPE i.
    out->write( 1 / lv_zero ).
  ENDMETHOD.
ENDCLASS.
