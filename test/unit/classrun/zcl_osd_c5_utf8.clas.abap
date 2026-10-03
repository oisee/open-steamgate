CLASS zcl_osd_c5_utf8 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_c5_utf8 IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_text TYPE string.
    lv_text = cl_abap_codepage=>convert_from( '4772C3BCC39F65' ).
    out->write( lv_text ).
  ENDMETHOD.
ENDCLASS.
