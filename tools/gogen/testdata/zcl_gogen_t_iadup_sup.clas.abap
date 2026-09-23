CLASS zcl_gogen_t_iadup_sup DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_iada.
    METHODS set.
ENDCLASS.

CLASS zcl_gogen_t_iadup_sup IMPLEMENTATION.
  METHOD set.
    zif_gogen_t_iadc~mv = 5.
  ENDMETHOD.
ENDCLASS.
