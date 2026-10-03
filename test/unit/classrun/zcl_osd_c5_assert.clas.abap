CLASS zcl_osd_c5_assert DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_c5_assert IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lo_descr TYPE REF TO cl_abap_classdescr.
    CREATE OBJECT lo_descr.
    lo_descr->get_super_class_type( ).
  ENDMETHOD.
ENDCLASS.
