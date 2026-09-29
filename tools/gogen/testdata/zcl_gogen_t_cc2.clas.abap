* A subclass with a class constructor of its own (ultra/events, ZCL_GOGEN_T_CCTOR).
CLASS zcl_gogen_t_cc2 DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_cc1 CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS class_constructor.
ENDCLASS.

CLASS zcl_gogen_t_cc2 IMPLEMENTATION.
  METHOD class_constructor.
    zcl_gogen_t_cclog=>add( `cc2` ).
  ENDMETHOD.
ENDCLASS.
