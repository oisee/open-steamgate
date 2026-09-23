CLASS zcl_gogen_t_iadup DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_iadup IMPLEMENTATION.
  METHOD run.
    DATA lo_s TYPE REF TO zcl_gogen_t_iadup_sub.
    DATA lo_b TYPE REF TO zif_gogen_t_iadb.
    DATA lo_a TYPE REF TO zif_gogen_t_iada.
    DATA lo_c TYPE REF TO zif_gogen_t_iadc.
    CREATE OBJECT lo_s.
    rv = |get:{ lo_s->get( ) }|.
    lo_b = lo_s.
    lo_a = lo_s.
    lo_c = lo_s.
    lo_b->zif_gogen_t_iadc~mv = 6.
    rv = |{ rv } a:{ lo_a->zif_gogen_t_iadc~mv } c:{ lo_c->mv } s:{ lo_s->zif_gogen_t_iadc~mv }|.
    lo_a->zif_gogen_t_iadc~mv = 7.
    rv = |{ rv } b:{ lo_b->zif_gogen_t_iadc~mv } get:{ lo_s->get( ) }|.
  ENDMETHOD.
ENDCLASS.
