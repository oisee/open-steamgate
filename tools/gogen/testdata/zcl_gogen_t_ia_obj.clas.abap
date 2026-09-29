CLASS zcl_gogen_t_ia_obj DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_ia.
    METHODS get RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_ia_obj IMPLEMENTATION.
  METHOD zif_gogen_t_ia~bump.
    zif_gogen_t_ia~mv_count = zif_gogen_t_ia~mv_count + 1.
    me->zif_gogen_t_ia~mv_ro = zif_gogen_t_ia~mv_count * 10.
  ENDMETHOD.
  METHOD get.
    DATA lo_me TYPE REF TO zcl_gogen_t_ia_obj.
    lo_me = me.
    lo_me->zif_gogen_t_ia~mv_ro = lo_me->zif_gogen_t_ia~mv_ro + 1.
    rv = me->zif_gogen_t_ia~mv_count.
  ENDMETHOD.
ENDCLASS.
