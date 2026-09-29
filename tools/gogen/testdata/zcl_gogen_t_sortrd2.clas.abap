* Split out of ZCL_GOGEN_T_SORTRD (ultra/events fix round): a READ TABLE
* WITH KEY on a SORTED table that names a key part and a component outside
* the key, and finds nothing. A4H answered 4/3, 8/5 and 4/-1 for the three
* (the same reads, inline in the measured SORTRD, 2026-09-24), which no rule
* derived here covers, so both emitters stop with NOT_COMPILED at the miss.
CLASS zcl_gogen_t_sortrd2 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_kv,
             k TYPE string,
             v TYPE i,
           END OF ty_kv.
    TYPES ty_sorted TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY k.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_sortrd2 IMPLEMENTATION.
  METHOD run.
    DATA lt_s TYPE ty_sorted.
    DATA ls_kv TYPE ty_kv.

    ls_kv-k = `m`. ls_kv-v = 3. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `B`. ls_kv-v = 1. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `x`. ls_kv-v = 4. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `c`. ls_kv-v = 2. INSERT ls_kv INTO TABLE lt_s.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `m` v = 3.
    rv = |hit:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `m` v = 9.
    rv = |{ rv } kv:{ sy-subrc }/{ sy-tabix }|.
  ENDMETHOD.
ENDCLASS.
