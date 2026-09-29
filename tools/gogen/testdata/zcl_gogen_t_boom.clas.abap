CLASS zcl_gogen_t_boom DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS inner IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_boom IMPLEMENTATION.
  METHOD inner.
    rv = 10 / iv.
  ENDMETHOD.
  METHOD run.
    DATA lv TYPE i.
    lv = inner( 0 ).
    rv = |{ lv }|.
  ENDMETHOD.
ENDCLASS.
