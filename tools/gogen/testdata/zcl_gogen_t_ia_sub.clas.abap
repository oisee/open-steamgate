CLASS zcl_gogen_t_ia_sub DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_ia_obj CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get REDEFINITION.
ENDCLASS.

CLASS zcl_gogen_t_ia_sub IMPLEMENTATION.
  METHOD get.
    zif_gogen_t_ia~mv_ro = 7.
    rv = zif_gogen_t_ia~mv_count + 1000 + zif_gogen_t_ia~mv_ro.
  ENDMETHOD.
ENDCLASS.
