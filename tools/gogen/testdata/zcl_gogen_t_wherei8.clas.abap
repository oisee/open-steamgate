CLASS zcl_gogen_t_wherei8 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(result) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_wherei8 IMPLEMENTATION.
  METHOD run.
    " WHERE over int8 (abapiti 043): an int8 component against an int8
    " value, an int8 component against an i value and an i component
    " against an int8 value all compare as int8, past the range of i
    TYPES: BEGIN OF entry, k TYPE int8, n TYPE i, END OF entry.
    DATA entries TYPE STANDARD TABLE OF entry WITH DEFAULT KEY.
    DATA row TYPE entry.
    DATA big TYPE int8 VALUE 5000000000.
    DATA small TYPE i VALUE 7.
    DATA wide TYPE int8 VALUE 7.
    APPEND VALUE #( k = big n = 1 ) TO entries.
    APPEND VALUE #( k = 7 n = 7 ) TO entries.
    APPEND VALUE #( k = 705032704 n = 3 ) TO entries.
    DELETE entries WHERE k = big.
    result = |d:{ sy-subrc }/{ lines( entries ) }|.
    LOOP AT entries INTO row WHERE k = small.
      result = |{ result } l:{ row-n }|.
    ENDLOOP.
    LOOP AT entries INTO row WHERE n = wide.
      result = |{ result } n:{ row-k }|.
    ENDLOOP.
    DELETE entries WHERE k > wide.
    result = |{ result } g:{ sy-subrc }/{ lines( entries ) }|.
  ENDMETHOD.
ENDCLASS.
