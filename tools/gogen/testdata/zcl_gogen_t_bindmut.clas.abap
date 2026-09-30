CLASS zcl_gogen_t_bindmut DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             k TYPE i,
             v TYPE i,
           END OF ty_row,
           ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
ENDCLASS.
CLASS zcl_gogen_t_bindmut IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA r TYPE ty_row.
    r-k = 1. r-v = 1. APPEND r TO lt.
    r-k = 1. r-v = 1. APPEND r TO lt.
    r-k = 2. r-v = 3. APPEND r TO lt.
    DELETE ADJACENT DUPLICATES FROM lt COMPARING ALL FIELDS.
    rv = |{ lines( lt ) }/{ lt[ 1 ]-v }|.
    REFRESH lt.
    rv = |{ rv }/{ lines( lt ) }|.
    APPEND r TO lt.
    FREE lt.
    rv = |{ rv }/{ lines( lt ) }|.
    APPEND r TO lt.
    CLEAR lt.
    rv = |{ rv }/{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
