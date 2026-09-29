CLASS zcl_gogen_t_inh DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_inh IMPLEMENTATION.
  METHOD run.
    DATA lo_base TYPE REF TO zcl_gogen_t_base.
    DATA lo_sub TYPE REF TO zcl_gogen_t_sub.
    DATA lo_none TYPE REF TO zcl_gogen_t_sub.
    CREATE OBJECT lo_sub.
    lo_base = lo_sub.
    rv = |{ lo_base->describe( ) } { lo_base->mv_log }|.
    CLEAR lo_sub.
    lo_sub ?= lo_base.
    rv = |{ rv } down:{ lo_sub->kind( ) }|.
    lo_base = lo_none.
    IF lo_base IS INITIAL.
      rv = |{ rv } initial|.
    ENDIF.
    CREATE OBJECT lo_sub TYPE ('ZCL_GOGEN_T_SUB').
    lo_base = lo_sub.
    rv = |{ rv } dyn:{ lo_base->name( ) }|.
    TRY.
        lo_sub ?= lo_none.
        rv = |{ rv } nullcast:ok|.
      CATCH cx_sy_move_cast_error.
        rv = |{ rv } nullcast:err|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
