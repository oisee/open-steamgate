CLASS zcl_gogen_t_uncaught DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(r) TYPE string.
    CLASS-METHODS get_log RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    CLASS-DATA log TYPE string.
    CLASS-METHODS inner.
ENDCLASS.

CLASS zcl_gogen_t_uncaught IMPLEMENTATION.
  METHOD get_log.
    r = log.
  ENDMETHOD.
  METHOD inner.
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rnochk.
      CLEANUP.
        log = log && '-inner'.
    ENDTRY.
  ENDMETHOD.
  METHOD run.
    log = 's'.
    " control: a handler further out, the CLEANUP runs
    TRY.
        TRY.
            RAISE EXCEPTION TYPE zcx_gogen_t_rnochk.
          CLEANUP.
            log = log && '-c'.
        ENDTRY.
      CATCH zcx_gogen_t_rnochk.
        log = log && '-h'.
    ENDTRY.
    " no handler anywhere (a CATCH of another class is none): no CLEANUP
    " runs, the dump is at the RAISE
    TRY.
        inner( ).
      CATCH zcx_gogen_t_rother.
        log = log && '-other'.
      CLEANUP.
        log = log && '-outer'.
    ENDTRY.
    r = log.
  ENDMETHOD.
ENDCLASS.
