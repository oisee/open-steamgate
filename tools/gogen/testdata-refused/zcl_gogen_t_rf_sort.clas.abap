* Moves that fill a SORTED table (ultra/events fix round): a system sorts
* the rows; the emitters would keep them in source order, so each is
* refused. A4H 2026-09-24 ($ZOSG_TMP_0441), this class without its last
* line: 'mv:ab vl:cd rk:dc empty:0 back:2' (sorted on the move, on VALUE,
* re-sorted by the other key); the last line, a STANDARD table for an
* IMPORTING parameter typed SORTED, does not activate ("LT_T is not
* type-compatible with formal parameter IT"), abaplint lets it through.
CLASS zcl_gogen_t_rf_sort DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_kv,
             k TYPE string,
             v TYPE i,
           END OF ty_kv.
    TYPES ty_std TYPE STANDARD TABLE OF ty_kv WITH DEFAULT KEY.
    TYPES ty_sorted TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY k.
    TYPES ty_sorted_v TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY v.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS show IMPORTING it TYPE ty_sorted RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS showv IMPORTING it TYPE ty_sorted_v RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rf_sort IMPLEMENTATION.
  METHOD show.
    DATA ls TYPE ty_kv.
    LOOP AT it INTO ls.
      rv = rv && ls-k.
    ENDLOOP.
  ENDMETHOD.

  METHOD showv.
    DATA ls TYPE ty_kv.
    LOOP AT it INTO ls.
      rv = rv && ls-k.
    ENDLOOP.
  ENDMETHOD.

  METHOD run.
    DATA lt_t TYPE ty_std.
    DATA lt_s TYPE ty_sorted.
    DATA lt_v TYPE ty_sorted_v.
    DATA ls TYPE ty_kv.
    ls-k = `b`. ls-v = 1. APPEND ls TO lt_t.
    ls-k = `a`. ls-v = 2. APPEND ls TO lt_t.
    lt_s = lt_t.
    rv = |mv:{ show( lt_s ) }|.
    lt_s = VALUE #( ( k = `d` v = 1 ) ( k = `c` v = 2 ) ).
    rv = |{ rv } vl:{ show( lt_s ) }|.
    lt_v = lt_s.
    rv = |{ rv } rk:{ showv( lt_v ) }|.
    lt_s = VALUE #( ).
    rv = |{ rv } empty:{ lines( lt_s ) }|.
    lt_t = lt_v.
    rv = |{ rv } back:{ lines( lt_t ) }|.
    rv = |{ rv } pm:{ show( lt_t ) }|.
  ENDMETHOD.
ENDCLASS.
