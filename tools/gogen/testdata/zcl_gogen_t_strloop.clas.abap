CLASS zcl_gogen_t_strloop DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strloop IMPLEMENTATION.
  METHOD run.
    DATA s TYPE string.
    s = `a b`.
    TRY.
        REPLACE ALL OCCURRENCES OF ' ' IN s WITH '_'.
        rv = `x1:none`.
      CATCH cx_dynamic_check.
        rv = `x1:dyn`.
    ENDTRY.
    TRY.
        REPLACE ALL OCCURRENCES OF '' IN s WITH '_'.
        rv = |{ rv } x2:none|.
      CATCH cx_root.
        rv = |{ rv } x2:root|.
    ENDTRY.
    rv = |{ rv } { s }|.
  ENDMETHOD.
ENDCLASS.
