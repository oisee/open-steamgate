* The log of ZCL_GOGEN_T_CCTOR's class constructors (ultra/events).
CLASS zcl_gogen_t_cclog DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_log TYPE string.
    CLASS-METHODS add IMPORTING iv TYPE string.
    CLASS-METHODS get RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_cclog IMPLEMENTATION.
  METHOD add.
    gv_log = gv_log && iv && ` `.
  ENDMETHOD.
  METHOD get.
    rv = gv_log.
  ENDMETHOD.
ENDCLASS.
