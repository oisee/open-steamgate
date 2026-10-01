CLASS zcl_osd_prove_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS double
      IMPORTING iv_in         TYPE i
      RETURNING VALUE(rv_out) TYPE i.
ENDCLASS.

CLASS zcl_osd_prove_demo IMPLEMENTATION.
  METHOD double.
    rv_out = iv_in * 2.
  ENDMETHOD.
ENDCLASS.
