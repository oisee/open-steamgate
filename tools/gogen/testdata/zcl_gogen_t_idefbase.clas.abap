CLASS zcl_gogen_t_idefbase DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS define RETURNING VALUE(result) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_idefbase IMPLEMENTATION.
  METHOD define.
    result = 'base'.
  ENDMETHOD.
ENDCLASS.
