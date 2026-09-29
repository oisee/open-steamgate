CLASS zcl_gogen_t_uncaught_read DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(r) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_uncaught_read IMPLEMENTATION.
  METHOD run.
    " runs after zcl_gogen_t_uncaught in the same process (objects in name
    " order) and reads what its CLEANUPs left in the static
    r = |log:{ zcl_gogen_t_uncaught=>get_log( ) }|.
  ENDMETHOD.
ENDCLASS.
