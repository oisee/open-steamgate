CLASS zcl_gogen_t_rf_own DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_rf_own IMPLEMENTATION.
  METHOD run.
    DATA lo_i TYPE REF TO zif_gogen_t_rf.
    rv = lo_i->zif_gogen_t_rf~mv_x.
  ENDMETHOD.
ENDCLASS.
