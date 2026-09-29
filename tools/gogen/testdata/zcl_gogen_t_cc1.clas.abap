* A class constructor and a static method (ultra/events, ZCL_GOGEN_T_CCTOR).
CLASS zcl_gogen_t_cc1 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS class_constructor.
    CLASS-METHODS touch.
ENDCLASS.

CLASS zcl_gogen_t_cc1 IMPLEMENTATION.
  METHOD class_constructor.
    zcl_gogen_t_cclog=>add( `cc1` ).
  ENDMETHOD.
  METHOD touch.
    zcl_gogen_t_cclog=>add( `t1` ).
  ENDMETHOD.
ENDCLASS.
