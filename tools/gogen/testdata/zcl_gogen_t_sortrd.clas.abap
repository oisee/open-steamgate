* READ TABLE ... WITH [TABLE] KEY on a SORTED table (ultra/events fix
* round): sy-subrc and sy-tabix on a hit and on each kind of miss (in the
* middle, before the first row, past the last, the whole key, a leading
* part of a two-component key, a key and a component outside it, only
* components outside the key, TABLE_LINE), and whether a miss touches the
* work area. Before each READ, READ ... INDEX 2 sets sy-tabix to 2.
CLASS zcl_gogen_t_sortrd DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_kv,
             k TYPE string,
             v TYPE i,
           END OF ty_kv.
    TYPES ty_sorted TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY k.
    TYPES: BEGIN OF ty_ab,
             a TYPE c LENGTH 1,
             b TYPE c LENGTH 1,
             v TYPE i,
           END OF ty_ab.
    TYPES ty_sorted2 TYPE SORTED TABLE OF ty_ab WITH UNIQUE KEY a b.
    TYPES ty_lines TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_sortrd IMPLEMENTATION.
  METHOD run.
    DATA lt_s TYPE ty_sorted.
    DATA ls_kv TYPE ty_kv.
    DATA lt_2 TYPE ty_sorted2.
    DATA ls_ab TYPE ty_ab.
    DATA lt_l TYPE ty_lines.
    DATA lv_l TYPE string.
    FIELD-SYMBOLS <ls_kv> TYPE ty_kv.

    ls_kv-k = `m`. ls_kv-v = 3. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `B`. ls_kv-v = 1. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `x`. ls_kv-v = 4. INSERT ls_kv INTO TABLE lt_s.
    ls_kv-k = `c`. ls_kv-v = 2. INSERT ls_kv INTO TABLE lt_s.

    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `m`.
    rv = |hit:{ sy-subrc }/{ sy-tabix }/{ ls_kv-v }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `d`.
    rv = |{ rv } mid:{ sy-subrc }/{ sy-tabix }/{ ls_kv-k }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `A`.
    rv = |{ rv } first:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `z`.
    rv = |{ rv } past:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH TABLE KEY k = `d`.
    rv = |{ rv } tk:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH TABLE KEY k = `z`.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s ASSIGNING <ls_kv> WITH KEY k = `n`.
    rv = |{ rv } fs:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s TRANSPORTING NO FIELDS WITH KEY k = `y`.
    rv = |{ rv } nf:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY v = 4.
    rv = |{ rv } nonkey:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY v = 9.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `m` v = 9.
    rv = |{ rv } kv:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY k = `x` v = 9.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_s INTO ls_kv INDEX 2.
    READ TABLE lt_s INTO ls_kv WITH KEY v = 3 k = `m`.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.

    ls_ab-a = '1'. ls_ab-b = '3'. ls_ab-v = 2. INSERT ls_ab INTO TABLE lt_2.
    ls_ab-a = '1'. ls_ab-b = '1'. ls_ab-v = 1. INSERT ls_ab INTO TABLE lt_2.
    ls_ab-a = '3'. ls_ab-b = '1'. ls_ab-v = 4. INSERT ls_ab INTO TABLE lt_2.
    ls_ab-a = '2'. ls_ab-b = '2'. ls_ab-v = 3. INSERT ls_ab INTO TABLE lt_2.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '1'.
    rv = |{ rv } lead:{ sy-subrc }/{ sy-tabix }/{ ls_ab-v }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '2'.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }/{ ls_ab-v }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '1' b = '2'.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '4'.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '0'.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY b = '2'.
    rv = |{ rv } second:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY b = '9'.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH KEY a = '2' v = 9.
    rv = |{ rv } av:{ sy-subrc }/{ sy-tabix }|.
    READ TABLE lt_2 INTO ls_ab INDEX 2.
    READ TABLE lt_2 INTO ls_ab WITH TABLE KEY a = '2' b = '3'.
    rv = |{ rv } tk2:{ sy-subrc }/{ sy-tabix }|.

    INSERT `q` INTO TABLE lt_l.
    INSERT `f` INTO TABLE lt_l.
    READ TABLE lt_l INTO lv_l INDEX 1.
    READ TABLE lt_l INTO lv_l WITH KEY table_line = `g`.
    rv = |{ rv } line:{ sy-subrc }/{ sy-tabix }/{ lv_l }|.
    READ TABLE lt_l INTO lv_l INDEX 1.
    READ TABLE lt_l INTO lv_l WITH KEY table_line = `q`.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }/{ lv_l }|.
    READ TABLE lt_l INTO lv_l INDEX 1.
    READ TABLE lt_l INTO lv_l WITH TABLE KEY table_line = `r`.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
  ENDMETHOD.
ENDCLASS.
