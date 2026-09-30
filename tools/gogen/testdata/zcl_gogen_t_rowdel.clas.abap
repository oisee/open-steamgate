CLASS zcl_gogen_t_rowdel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE i,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
ENDCLASS.
CLASS zcl_gogen_t_rowdel IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    DATA lr TYPE REF TO ty_row.
    ls-k = 1. APPEND ls TO lt.
    ls-k = 2. APPEND ls TO lt.
    READ TABLE lt REFERENCE INTO lr WITH KEY k = 1.
    DELETE lt INDEX 1.
    lr->v = 9.
    rv = `deleted row changed`.
  ENDMETHOD.
ENDCLASS.
