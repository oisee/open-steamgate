CLASS zcl_gogen_t_dyn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mv TYPE i VALUE 7.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_dyn IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_dyn.
    DATA lv_name TYPE c LENGTH 30.
    lv_name = 'ZCL_GOGEN_T_DYN'.
    CREATE OBJECT lo TYPE (lv_name).
    rv = |upper:{ lo->mv }|.
    TRY.
        CREATE OBJECT lo TYPE ('zcl_gogen_t_dyn').
        rv = |{ rv } lower:ok|.
      CATCH cx_sy_create_object_error.
        rv = |{ rv } lower:err|.
    ENDTRY.
    TRY.
        CREATE OBJECT lo TYPE ('ZCL_GOGEN_T_NOPE').
        rv = |{ rv } unknown:ok|.
      CATCH cx_sy_create_object_error.
        rv = |{ rv } unknown:err|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
