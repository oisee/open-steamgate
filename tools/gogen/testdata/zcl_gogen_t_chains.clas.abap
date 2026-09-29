CLASS zcl_gogen_t_chains DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_chains.
    CLASS-DATA gv_log TYPE string.
    DATA mv_name TYPE string.
    DATA mv_hits TYPE i.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS make IMPORTING iv TYPE string RETURNING VALUE(ro) TYPE REF TO zcl_gogen_t_chains.
    CLASS-METHODS note IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
    METHODS text RETURNING VALUE(rv) TYPE string.
    METHODS succ RETURNING VALUE(ro) TYPE REF TO zcl_gogen_t_chains.
    METHODS self RETURNING VALUE(ro) TYPE REF TO zcl_gogen_t_chains.
    METHODS tail IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
    METHODS bump.
    METHODS inst RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_chains IMPLEMENTATION.
  METHOD make.
    gv_log = |{ gv_log }m{ iv }|.
    CREATE OBJECT ro.
    ro->mv_name = iv.
  ENDMETHOD.
  METHOD note.
    gv_log = |{ gv_log }n{ iv }|.
    rv = iv.
  ENDMETHOD.
  METHOD text.
    rv = |{ mv_name }{ mv_hits }|.
  ENDMETHOD.
  METHOD succ.
    ro = make( |{ mv_name }+| ).
  ENDMETHOD.
  METHOD self.
    ro = me.
  ENDMETHOD.
  METHOD tail.
    gv_log = |{ gv_log }t{ iv }|.
    rv = |{ mv_name }.{ iv }|.
  ENDMETHOD.
  METHOD bump.
    mv_hits = mv_hits + 1.
  ENDMETHOD.
  METHOD zif_gogen_t_chains~get.
    ro = me.
  ENDMETHOD.
  METHOD zif_gogen_t_chains~label.
    rv = |<{ mv_name }{ mv_hits }>|.
  ENDMETHOD.
  METHOD inst.
    " m( )->n( ) and me->m( )->n( ) as statements, inside an instance
    self( )->bump( ).
    me->self( )->bump( ).
    " as operands, and zif~m( )->n( ) through an interface reference
    rv = |{ self( )->text( ) } { me->self( )->text( ) } { zif_gogen_t_chains~get( )->label( ) } { zif_gogen_t_chains~get( )->get( )->label( ) }|.
  ENDMETHOD.
  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_chains.
    CLEAR gv_log.
    rv = make( `a` )->text( ).
    rv = |{ rv } { make( `b` )->succ( )->text( ) }|.
    rv = |{ rv } { zcl_gogen_t_chains=>make( `c` )->text( ) }|.
    lo = make( `d` ).
    rv = |{ rv } { lo->inst( ) }|.
    " a chain as a statement on an object nobody keeps
    make( `e` )->bump( ).
    " the head of the chain and the argument of its tail: which runs first
    rv = |{ rv } { make( `f` )->tail( note( `x` ) ) }|.
    rv = |{ rv } { note( make( `g` )->succ( )->text( ) ) }|.
    IF make( `h` )->text( ) = `h0`.
      rv = |{ rv } if|.
    ENDIF.
    rv = |{ rv } log:{ gv_log }|.
  ENDMETHOD.
ENDCLASS.
