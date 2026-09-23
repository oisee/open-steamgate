CLASS zcl_gogen_t_sub DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_base CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor.
    METHODS name REDEFINITION.
    METHODS kind REDEFINITION.
ENDCLASS.

CLASS zcl_gogen_t_sub IMPLEMENTATION.
  METHOD constructor.
    super->constructor( iv_tag = `t1` ).
    mv_tag = |{ mv_tag }+|.
  ENDMETHOD.
  METHOD name.
    rv = |sub<{ super->name( ) }>|.
  ENDMETHOD.
  METHOD kind.
    rv = `k`.
  ENDMETHOD.
ENDCLASS.
