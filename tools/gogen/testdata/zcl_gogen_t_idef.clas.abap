CLASS zcl_gogen_t_idef DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_idefbase CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS define REDEFINITION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_idef IMPLEMENTATION.
  METHOD define.
    result = super->define( ) && '/child'.
  ENDMETHOD.
  METHOD run.
    DATA obj TYPE REF TO zcl_gogen_t_idef.
    CREATE OBJECT obj.
    rv = obj->define( ).
  ENDMETHOD.
ENDCLASS.
