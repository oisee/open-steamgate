CLASS zcl_gogen_t_raise DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    CLASS-DATA log TYPE string.
    CLASS-METHODS inner RAISING zcx_gogen_t_rbase.
    CLASS-METHODS nested RAISING zcx_gogen_t_rbase.
    CLASS-METHODS nocheck.
ENDCLASS.

CLASS zcl_gogen_t_raise IMPLEMENTATION.
  METHOD inner.
    TRY.
        log = log && 'i1'.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 3.
      CLEANUP.
        log = log && '-ci'.
    ENDTRY.
    log = log && '-never'.
  ENDMETHOD.
  METHOD nested.
    TRY.
        inner( ).
      CATCH zcx_gogen_t_rother.
        log = log && '-other'.
      CLEANUP.
        log = log && '-co'.
    ENDTRY.
  ENDMETHOD.
  METHOD nocheck.
    RAISE EXCEPTION TYPE zcx_gogen_t_rnochk.
  ENDMETHOD.
  METHOD run.
    DATA lx TYPE REF TO zcx_gogen_t_rbase.
    DATA lx2 TYPE REF TO zcx_gogen_t_rbase.
    DATA lo TYPE REF TO zcx_gogen_t_rsub.
    DATA lr TYPE REF TO cx_root.
    DATA ls TYPE REF TO cx_static_check.
    DATA lv TYPE i.
    " 1 raise sub, catch base by hierarchy, attribute
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 7.
        r = r && 'not'.
      CATCH zcx_gogen_t_rbase INTO lx.
        r = r && |h:{ lx->num }|.
    ENDTRY.
    " 2 the first CATCH that fits, the subclass listed first
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 1.
      CATCH zcx_gogen_t_rsub.
        r = r && ' first:sub'.
      CATCH zcx_gogen_t_rbase.
        r = r && ' first:base'.
    ENDTRY.
    " 3 CLEANUP order: inner, outer, then the handler
    log = ''.
    TRY.
        nested( ).
      CATCH zcx_gogen_t_rbase INTO lx.
        log = log && |-h{ lx->num }|.
    ENDTRY.
    r = r && | clean:{ log }|.
    " 4 raised in a CATCH: no CLEANUP of the same TRY
    log = ''.
    TRY.
        TRY.
            RAISE EXCEPTION TYPE zcx_gogen_t_rother.
          CATCH zcx_gogen_t_rother.
            log = log && 'c'.
            RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 4.
          CLEANUP.
            log = log && 'x'.
        ENDTRY.
      CATCH zcx_gogen_t_rbase.
        log = log && 'h'.
    ENDTRY.
    r = r && | incatch:{ log }|.
    " 5 get_text of a class without a text
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub.
      CATCH zcx_gogen_t_rbase INTO lx.
        r = r && | text:[{ lx->get_text( ) }]|.
    ENDTRY.
    " 6 an existing object: the same one arrives
    CREATE OBJECT lo EXPORTING num = 9.
    TRY.
        RAISE EXCEPTION lo.
      CATCH zcx_gogen_t_rbase INTO lx2.
        lx2->num = lx2->num * 2.
        r = r && | same:{ lo->num }|.
    ENDTRY.
    " 7 previous; two classes in one CATCH
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 5 previous = lo.
      CATCH zcx_gogen_t_rother zcx_gogen_t_rbase INTO ls.
        lx2 ?= ls->previous.
        r = r && | prev:{ lx2->num }|.
    ENDTRY.
    " 8 cx_no_check through a method without RAISING
    TRY.
        nocheck( ).
      CATCH zcx_gogen_t_rnochk.
        r = r && ' nocheck'.
    ENDTRY.
    " 9 the same object raised twice keeps what a handler changed
    TRY.
        RAISE EXCEPTION lo.
      CATCH zcx_gogen_t_rbase INTO lx.
        lx->num = lx->num + 1.
    ENDTRY.
    TRY.
        RAISE EXCEPTION lo.
      CATCH zcx_gogen_t_rbase INTO lx.
        r = r && | again:{ lx->num }|.
    ENDTRY.
    " 10 the INTO of a CATCH not taken stays as it was
    CLEAR lx2.
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rother.
      CATCH zcx_gogen_t_rbase INTO lx2.
        r = r && ' wrong'.
      CATCH zcx_gogen_t_rother.
        IF lx2 IS INITIAL.
          r = r && ' untaken:initial'.
        ENDIF.
    ENDTRY.
    " 11 cx_root takes a raised object and a runtime exception alike
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rother.
      CATCH cx_root INTO lr.
        r = r && | root:[{ lr->get_text( ) }]|.
    ENDTRY.
    TRY.
        lv = 1 / lv.
      CATCH cx_root.
        r = r && ' root:zerodivide'.
    ENDTRY.
    " 12 a runtime exception passes a CLEANUP too
    log = ''.
    TRY.
        TRY.
            lv = 1 / lv.
          CLEANUP.
            log = log && 'c'.
        ENDTRY.
      CATCH cx_sy_zerodivide.
        log = log && 'h'.
    ENDTRY.
    r = r && | rt:{ log }|.
  ENDMETHOD.
ENDCLASS.
