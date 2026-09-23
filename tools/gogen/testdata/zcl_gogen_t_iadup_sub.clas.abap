CLASS zcl_gogen_t_iadup_sub DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_iadup_sup CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_iadb.
    METHODS get RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_iadup_sub IMPLEMENTATION.
  METHOD get.
    set( ).
    rv = zif_gogen_t_iadc~mv.
  ENDMETHOD.
ENDCLASS.
