CLASS zcl_gogen_t_uncatch DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_uncatch IMPLEMENTATION.
  METHOD run.
    TRY.
        DATA(pos) = find( val = `x` sub = `x` occ = 0 ).
        rv = |{ pos }|.
      CATCH cx_root.
        rv = `caught`.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
