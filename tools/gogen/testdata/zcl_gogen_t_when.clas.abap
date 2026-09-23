CLASS zcl_gogen_t_when DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS kind IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_when IMPLEMENTATION.
  METHOD kind.
    CASE iv.
      WHEN 'a' OR 'b' OR 'c'.
        rv = `abc`.
      WHEN 'd'.
        rv = `d`.
      WHEN OTHERS.
        rv = `-`.
    ENDCASE.
  ENDMETHOD.
  METHOD run.
    rv = |{ kind( `a` ) } { kind( `b` ) } { kind( `c` ) } { kind( `d` ) } { kind( `e` ) }|.
  ENDMETHOD.
ENDCLASS.
