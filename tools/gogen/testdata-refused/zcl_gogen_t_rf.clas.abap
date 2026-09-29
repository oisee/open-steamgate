CLASS zcl_gogen_t_rf DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_rf IMPLEMENTATION.
  METHOD run.
    DATA lo_i TYPE REF TO zif_gogen_t_rf.
    DATA lo_o TYPE REF TO zcl_gogen_t_rf_obj.
    CREATE OBJECT lo_o.
    lo_i = lo_o.
    rv = lo_i->mv_v.
    lo_i->mv_ro = 1.
    lo_o->zif_gogen_t_rf~mv_ro = 2.
    rv = lo_i->co_k.
    lo_i->value = 3.
    lo_i->mv_x = 4.
    rv = lo_i->mv_ro.
  ENDMETHOD.
ENDCLASS.
