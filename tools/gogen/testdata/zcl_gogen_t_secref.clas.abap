CLASS zcl_gogen_t_secref DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE string,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY
      WITH UNIQUE SORTED KEY sec COMPONENTS k.
ENDCLASS.

CLASS zcl_gogen_t_secref IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    DATA lr TYPE REF TO ty_row.
    ls-k = `b`. ls-v = 2. APPEND ls TO lt.
    ls-k = `a`. ls-v = 1. APPEND ls TO lt.
    READ TABLE lt WITH KEY sec COMPONENTS k = `b` REFERENCE INTO lr.
    lr->v = 7.
    READ TABLE lt INTO ls INDEX 1.
    rv = |{ sy-subrc }/{ ls-v }|.
  ENDMETHOD.
ENDCLASS.
