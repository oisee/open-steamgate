* Resumable exceptions need a continuation at the RAISE site. Until the Go
* emitter can resume across nested calls, this form must refuse compilation.
CLASS zcl_gogen_t_rf_resume DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_rf_resume IMPLEMENTATION.
  METHOD run.
    TRY.
        RAISE RESUMABLE EXCEPTION TYPE cx_sy_zerodivide.
      CATCH BEFORE UNWIND cx_sy_zerodivide.
        RESUME.
    ENDTRY.
    rv = `resumed`.
  ENDMETHOD.
ENDCLASS.
