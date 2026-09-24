* = and <> between object references of different static types (ultra/json
* fix round, critic finding 3): two initial references are equal whatever
* their static types, an initial one is not equal to a bound one, and a
* subclass reference equals a superclass or interface reference to the same
* object. Go compared any((*Sub)(nil)) with any((*Base)(nil)) and said ne.
CLASS zcl_gogen_t_refeq DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_refeq IMPLEMENTATION.
  METHOD run.
    DATA lo_sub TYPE REF TO zcl_gogen_t_sub.
    DATA lo_base TYPE REF TO zcl_gogen_t_base.
    DATA lo_cls TYPE REF TO zcl_gogen_t_ia_sub.
    DATA li_ia TYPE REF TO zif_gogen_t_ia.
    DATA lo_b2 TYPE REF TO zcl_gogen_t_base.
* both initial, different static types
    IF lo_sub = lo_base. rv = |{ rv }sb:eq|. ELSE. rv = |{ rv }sb:ne|. ENDIF.
    IF lo_base <> lo_sub. rv = |{ rv } bs:ne|. ELSE. rv = |{ rv } bs:eq|. ENDIF.
    IF lo_cls = li_ia. rv = |{ rv } ci:eq|. ELSE. rv = |{ rv } ci:ne|. ENDIF.
    IF li_ia = lo_cls. rv = |{ rv } ic:eq|. ELSE. rv = |{ rv } ic:ne|. ENDIF.
* one bound, one initial
    CREATE OBJECT lo_sub.
    IF lo_sub = lo_base. rv = |{ rv } b1:eq|. ELSE. rv = |{ rv } b1:ne|. ENDIF.
    IF lo_base = lo_sub. rv = |{ rv } b2:eq|. ELSE. rv = |{ rv } b2:ne|. ENDIF.
* the same object through two static types
    lo_base = lo_sub.
    IF lo_sub = lo_base. rv = |{ rv } same:eq|. ELSE. rv = |{ rv } same:ne|. ENDIF.
    CREATE OBJECT lo_cls.
    li_ia = lo_cls.
    IF li_ia = lo_cls. rv = |{ rv } isame:eq|. ELSE. rv = |{ rv } isame:ne|. ENDIF.
    CLEAR li_ia.
    IF lo_cls <> li_ia. rv = |{ rv } icl:ne|. ELSE. rv = |{ rv } icl:eq|. ENDIF.
* a cleared reference against one never set
    CLEAR lo_sub.
    IF lo_sub = lo_b2. rv = |{ rv } clr:eq|. ELSE. rv = |{ rv } clr:ne|. ENDIF.
  ENDMETHOD.
ENDCLASS.
