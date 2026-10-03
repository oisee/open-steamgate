CLASS zcl_osd_c5_constructor DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS constructor.
ENDCLASS.
CLASS zcl_osd_c5_constructor IMPLEMENTATION.
  METHOD constructor.
    DATA lv_zero TYPE i.
    DATA lv_result TYPE i.
    lv_result = 1 / lv_zero.
  ENDMETHOD.
  METHOD if_oo_adt_classrun~main.
    out->write( `must not run` ).
  ENDMETHOD.
ENDCLASS.
