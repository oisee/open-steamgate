CLASS zcl_gogen_t_rng DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rng IMPLEMENTATION.
  METHOD run.
* a RANGE OF of an interface method's signature, built in another class
* than the one that implements it (the row type is the interface's)
    DATA lo TYPE REF TO zif_gogen_t_rng.
    DATA lt_range TYPE zif_gogen_t_rng=>tt_range.
    DATA ls_range LIKE LINE OF lt_range.
    DATA lt_keys TYPE zif_gogen_t_rng=>tt_keys.
    lo = NEW zcl_gogen_t_rngimpl( ).
    lt_keys = lo->read( ).
    rv = |all:{ lines( lt_keys ) }|.
    ls_range-sign = 'I'.
    ls_range-option = 'EQ'.
    ls_range-low = 'B'.
    APPEND ls_range TO lt_range.
    lt_keys = lo->read( lt_range ).
    rv = |{ rv } b:{ lines( lt_keys ) }|.
  ENDMETHOD.
ENDCLASS.
