* A class constructor that raises CX_SY_ZERODIVIDE (ultra/events fix
* round), used by ZCL_GOGEN_T_CCBOOM2.
CLASS zcl_gogen_t_ccboom DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_n TYPE i.
    CLASS-METHODS class_constructor.
    CLASS-METHODS touch RETURNING VALUE(rv) TYPE i.
  PROTECTED SECTION.
ENDCLASS.

CLASS zcl_gogen_t_ccboom IMPLEMENTATION.
  METHOD class_constructor.
    DATA lv_z TYPE i.
    gv_n = 5.
    gv_n = gv_n / lv_z.
  ENDMETHOD.

  METHOD touch.
    rv = gv_n.
  ENDMETHOD.
ENDCLASS.
