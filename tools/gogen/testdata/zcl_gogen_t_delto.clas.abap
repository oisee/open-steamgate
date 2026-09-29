* DELETE itab (the current row) inside LOOP ... FROM i TO j: how the TO
* bound moves when rows go was not measured on A4H, so it is refused
* (NOT_COMPILED); without TO it compiles (ZCL_GOGEN_T_NSCN).
CLASS zcl_gogen_t_delto DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_delto IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv TYPE string.
    APPEND `a` TO lt. APPEND `b` TO lt. APPEND `c` TO lt.
    LOOP AT lt INTO lv FROM 1 TO 2.
      DELETE lt.
    ENDLOOP.
    rv = |{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
