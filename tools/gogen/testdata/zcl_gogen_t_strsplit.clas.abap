CLASS zcl_gogen_t_strsplit DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strsplit IMPLEMENTATION.
  METHOD run.
    DATA a TYPE string.
    DATA b TYPE string.
    DATA c TYPE string.
    DATA s TYPE string.
    DATA c2 TYPE c LENGTH 2.
    DATA d2 TYPE c LENGTH 2.
    SPLIT `a,b,c,d` AT ',' INTO a b.
    rv = |more:{ a }/{ b }/{ sy-subrc }|.
    a = `x`. b = `x`. c = `x`.
    SPLIT `a` AT ',' INTO a b c.
    rv = |{ rv } fewer:{ a }/{ b }/{ c }/{ sy-subrc }|.
    a = `x`. b = `x`. c = `x`.
    SPLIT `a,b,` AT ',' INTO a b c.
    rv = |{ rv } trail:{ a }/{ b }/{ c }/{ sy-subrc }|.
    a = `x`. b = `x`. c = `x`.
    SPLIT `a,,b` AT ',' INTO a b c.
    rv = |{ rv } empty:{ a }/{ b }/{ c }|.
    a = `x`. b = `x`.
    SPLIT `` AT ',' INTO a b.
    rv = |{ rv } none:{ a }/{ b }/{ sy-subrc }|.
    SPLIT `,a` AT ',' INTO a b.
    rv = |{ rv } lead:{ a }/{ b }|.
    SPLIT `a,b,c,` AT ',' INTO a b.
    rv = |{ rv } resttrail:{ a }/{ b }|.
    SPLIT `abc,d` AT ',' INTO c2 d2.
    rv = |{ rv } trunc:{ c2 }/{ d2 }/{ sy-subrc }|.
    SPLIT `ab,cde` AT ',' INTO c2 d2.
    rv = |{ rv } trunc2:{ c2 }/{ d2 }/{ sy-subrc }|.
    SPLIT `a  b` AT space INTO a b c.
    rv = |{ rv } space:{ a }/{ b }/{ c }|.
    SPLIT `a b ` AT ` ` INTO a b c.
    rv = |{ rv } str:[{ a }]/[{ b }]/[{ c }]|.
    s = `p=q`.
    SPLIT s AT '=' INTO s a.
    rv = |{ rv } self:{ s }/{ a }|.
    SPLIT `a=>b` AT '=>' INTO a b.
    rv = |{ rv } two:{ a }/{ b }|.
  ENDMETHOD.
ENDCLASS.
