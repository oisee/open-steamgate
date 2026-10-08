CLASS zcl_gogen_t_delfrom DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_b,
             prefix TYPE string,
             uri    TYPE string,
           END OF ty_b.
    TYPES: BEGIN OF ty_c,
             k1 TYPE i,
             k2 TYPE c LENGTH 2,
             v  TYPE string,
           END OF ty_c.
ENDCLASS.

CLASS zcl_gogen_t_delfrom IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE HASHED TABLE OF ty_b WITH UNIQUE KEY prefix.
    DATA ls TYPE ty_b.
    DATA lc TYPE HASHED TABLE OF ty_c WITH UNIQUE KEY k1 k2.
    DATA lo TYPE SORTED TABLE OF ty_c WITH UNIQUE KEY k2.
    DATA wc TYPE ty_c.
    ls-prefix = `a`. ls-uri = `x`. INSERT ls INTO TABLE lt.
    ls-prefix = `b`. ls-uri = `y`. INSERT ls INTO TABLE lt.
    CLEAR ls. ls-prefix = `a`. ls-uri = `other`.
    " only the key decides: the non-key field differs
    DELETE TABLE lt FROM ls.
    rv = |{ sy-subrc }/{ lines( lt ) }|.
    DELETE TABLE lt FROM ls.
    rv = |{ rv }/{ sy-subrc }/{ lines( lt ) }|.
    rv = |{ rv }/|.
    LOOP AT lt INTO ls.
      rv = |{ rv }{ ls-prefix }|.
    ENDLOOP.
    wc-k1 = 1. wc-k2 = 'a'. INSERT wc INTO TABLE lc.
    wc-k1 = 1. wc-k2 = 'b'. INSERT wc INTO TABLE lc.
    wc-k1 = 2. wc-k2 = 'a'. INSERT wc INTO TABLE lc.
    CLEAR wc. wc-k1 = 1. wc-k2 = 'b'.
    DELETE TABLE lc FROM wc.
    rv = |{ rv }/{ sy-subrc }/{ lines( lc ) }|.
    LOOP AT lc INTO wc.
      rv = |{ rv }{ wc-k1 }{ wc-k2 }|.
    ENDLOOP.
    wc-k2 = 'c'. INSERT wc INTO TABLE lo.
    wc-k2 = 'a'. INSERT wc INTO TABLE lo.
    wc-k2 = 'b'. INSERT wc INTO TABLE lo.
    CLEAR wc. wc-k2 = 'b'.
    DELETE TABLE lo FROM wc.
    rv = |{ rv }/{ sy-subrc }/|.
    LOOP AT lo INTO wc.
      rv = |{ rv }{ wc-k2 }|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
