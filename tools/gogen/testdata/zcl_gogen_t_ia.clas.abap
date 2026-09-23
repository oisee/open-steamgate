CLASS zcl_gogen_t_ia DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_ia IMPLEMENTATION.
  METHOD run.
    DATA lo_i TYPE REF TO zif_gogen_t_ia.
    DATA lo_j TYPE REF TO zif_gogen_t_ia.
    DATA lo_o TYPE REF TO zcl_gogen_t_ia_obj.
    DATA lo_s TYPE REF TO zcl_gogen_t_ia_sub.
    DATA lo_2 TYPE REF TO zif_gogen_t_ia2.
    CREATE OBJECT lo_o.
    lo_i = lo_o.
    rv = |init:{ lo_i->mv_count }|.
    lo_i->mv_count = 7.
    rv = |{ rv } o:{ lo_o->zif_gogen_t_ia~mv_count }|.
    lo_o->zif_gogen_t_ia~mv_count = lo_o->zif_gogen_t_ia~mv_count + 1.
    rv = |{ rv } i:{ lo_i->mv_count }|.
    lo_i->bump( ).
    rv = |{ rv } bump:{ lo_i->mv_count },{ lo_i->mv_ro },{ lo_o->zif_gogen_t_ia~mv_ro },{ lo_o->get( ) }|.
    lo_i->ms_pair-a = 3.
    lo_i->ms_pair-b = `p`.
    rv = |{ rv } pair:{ lo_o->zif_gogen_t_ia~ms_pair-a }{ lo_o->zif_gogen_t_ia~ms_pair-b }|.
    lo_i->zif_gogen_t_ia2~mv_inner = `in`.
    lo_2 = lo_o.
    rv = |{ rv } inner:{ lo_o->zif_gogen_t_ia2~mv_inner },{ lo_2->mv_inner }|.
    lo_2->mv_inner = `two`.
    rv = |{ rv },{ lo_i->zif_gogen_t_ia2~mv_inner }|.
    lo_j = lo_i.
    lo_j->mv_name = `shared`.
    rv = |{ rv } alias:{ lo_i->mv_name }|.
    CREATE OBJECT lo_o.
    lo_j = lo_o.
    rv = |{ rv } other:{ lo_j->mv_count },{ lo_j->mv_name } first:{ lo_i->mv_count },{ lo_i->mv_name }|.
    CREATE OBJECT lo_s.
    lo_i = lo_s.
    lo_i->mv_count = 42.
    rv = |{ rv } sub:{ lo_s->zif_gogen_t_ia~mv_count },{ lo_s->get( ) }|.
    lo_o = lo_s.
    lo_o->zif_gogen_t_ia~mv_count = 43.
    rv = |{ rv },{ lo_i->mv_count },{ lo_i->mv_ro }|.
    lo_o ?= lo_j.
    lo_o->get( ).
    lo_o->get( ).
    rv = |{ rv } ro:{ lo_j->mv_ro }|.
  ENDMETHOD.
ENDCLASS.
