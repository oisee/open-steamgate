CLASS zcl_osd_c5_rollback DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_c5_rollback IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA ls_row TYPE zstg_demo.
    DATA lv_zero TYPE i.
    ls_row-mandt = sy-mandt.
    ls_row-travel_id = 'C5DUMP'.
    INSERT zstg_demo FROM ls_row.
    out->write( 'before the dump' ).
    out->write( 1 / lv_zero ).
  ENDMETHOD.
ENDCLASS.
