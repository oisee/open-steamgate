CLASS zcl_gogen_t_sortref DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE SORTED TABLE OF ty_row WITH UNIQUE KEY k.
ENDCLASS.

CLASS zcl_gogen_t_sortref IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    DATA lr TYPE REF TO ty_row.
    ls-k = `m`. ls-v = 1.
    INSERT ls INTO TABLE lt REFERENCE INTO lr.
    ls-k = `a`. ls-v = 2. INSERT ls INTO TABLE lt.
    ls-k = `b`. ls-v = 3. INSERT ls INTO TABLE lt.
    lr->v = 9.
    READ TABLE lt INTO ls WITH KEY k = `m`.
    rv = |m:{ ls-v }|.
    READ TABLE lt INTO ls WITH KEY k = `a`.
    rv = |{ rv } a:{ ls-v }|.
  ENDMETHOD.
ENDCLASS.
