* Child-table probe for B0, through the same FM a system uses.
CLASS zcl_osd_adt_enq_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_adt_enq_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_number TYPE i.
    CALL FUNCTION 'ENQUEUE_READ'
      EXPORTING gname = 'ZOSD_ADT_LOCK' guname = space
      IMPORTING number = lv_number.
    out->write( lv_number ).
  ENDMETHOD.
ENDCLASS.
