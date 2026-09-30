CLASS zcl_gogen_t_bound DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS bound IMPORTING iv TYPE any RETURNING VALUE(rv) TYPE abap_bool.
ENDCLASS.

CLASS zcl_gogen_t_bound IMPLEMENTATION.
  METHOD bound.
    rv = xsdbool( iv IS BOUND ).
  ENDMETHOD.
  METHOD run.
    DATA lr TYPE REF TO data.
    rv = bound( lr ).
    CREATE DATA lr TYPE i.
    rv = |{ rv }{ bound( lr ) }|.
  ENDMETHOD.
ENDCLASS.
