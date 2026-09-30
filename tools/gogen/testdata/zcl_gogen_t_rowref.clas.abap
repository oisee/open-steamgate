CLASS zcl_gogen_t_rowref DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE i,
             v TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
ENDCLASS.
CLASS zcl_gogen_t_rowref IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    DATA lr TYPE REF TO ty_row.
    ls-k = 1. ls-v = 1. APPEND ls TO lt REFERENCE INTO lr.
    DO 64 TIMES.
      ls-k = sy-index + 1. APPEND ls TO lt.
    ENDDO.
    lr->v = 9.
    READ TABLE lt INTO ls WITH KEY k = 1.
    rv = |append:{ ls-v }|.
  ENDMETHOD.
ENDCLASS.
