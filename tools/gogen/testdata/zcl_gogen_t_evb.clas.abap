* A sender class for ZCL_GOGEN_T_EVENTS3: its event, raised by FIRE.
CLASS zcl_gogen_t_evb DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    EVENTS e.
    DATA mv_name TYPE string.
    METHODS constructor IMPORTING name TYPE string.
    METHODS fire.
ENDCLASS.

CLASS zcl_gogen_t_evb IMPLEMENTATION.
  METHOD constructor.
    mv_name = name.
  ENDMETHOD.

  METHOD fire.
    RAISE EVENT e.
  ENDMETHOD.
ENDCLASS.
