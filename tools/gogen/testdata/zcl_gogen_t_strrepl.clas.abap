CLASS zcl_gogen_t_strrepl DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strrepl IMPLEMENTATION.
  METHOD run.
    DATA s TYPE string.
    DATA c10 TYPE c LENGTH 10.
    DATA c4 TYPE c LENGTH 4.
    s = `abcabc`.
    REPLACE FIRST OCCURRENCE OF `b` IN s WITH `XY`.
    rv = |first:{ s }/{ sy-subrc }|.
    REPLACE FIRST OCCURRENCE OF `z` IN s WITH `-`.
    rv = |{ rv } miss:{ s }/{ sy-subrc }|.
    s = `abcabc`.
    REPLACE ALL OCCURRENCES OF REGEX `b|c` IN s WITH `-`.
    rv = |{ rv } rxall:{ s }/{ sy-subrc }|.
    s = `abc`.
    REPLACE ALL OCCURRENCES OF REGEX `x*` IN s WITH `-`.
    rv = |{ rv } rxempty:{ s }/{ sy-subrc }|.
    s = `abbc`.
    REPLACE ALL OCCURRENCES OF REGEX `b*` IN s WITH `-`.
    rv = |{ rv } rxstar:{ s }|.
    s = `abab`.
    REPLACE ALL OCCURRENCES OF REGEX `(a)(b)` IN s WITH `$2$1$0`.
    rv = |{ rv } groups:{ s }|.
    s = `aXbX`.
    REPLACE FIRST OCCURRENCE OF REGEX `a|aX` IN s WITH `-`.
    rv = |{ rv } longest:{ s }|.
    s = `abab`.
    REPLACE FIRST OCCURRENCE OF REGEX `z` IN s WITH `-`.
    rv = |{ rv } rxmiss:{ sy-subrc }|.
    s = `abcabc`.
    REPLACE ALL OCCURRENCES OF `b` IN SECTION OFFSET 2 LENGTH 3 OF s WITH `-`.
    rv = |{ rv } sect:{ s }/{ sy-subrc }|.
    s = `abcabcabc`.
    REPLACE ALL OCCURRENCES OF `b` IN SECTION OFFSET 2 OF s WITH `-`.
    rv = |{ rv } sectoff:{ s }|.
    s = `abcabc`.
    REPLACE ALL OCCURRENCES OF `b` IN SECTION LENGTH 3 OF s WITH `-`.
    rv = |{ rv } sectlen:{ s }|.
    s = `abc`.
    REPLACE ALL OCCURRENCES OF `b` IN s WITH `$0`.
    rv = |{ rv } dollar:{ s }|.
    s = `a.b.`.
    REPLACE ALL OCCURRENCES OF '.' IN s WITH ''.
    rv = |{ rv } cwith:{ s }|.
    s = `a b`.
    REPLACE ALL OCCURRENCES OF 'b ' IN s WITH 'X '.
    rv = |{ rv } ctrail:[{ s }]|.
    c10 = `a b`.
    REPLACE ALL OCCURRENCES OF `b` IN c10 WITH `-`.
    rv = |{ rv } cten:{ c10 }/{ sy-subrc }|.
    c4 = `abcd`.
    REPLACE FIRST OCCURRENCE OF `b` IN c4 WITH `XYZ`.
    rv = |{ rv } ctrunc:{ c4 }/{ sy-subrc }|.
    s = `aAa`.
    REPLACE ALL OCCURRENCES OF `a` IN s WITH `-` IGNORING CASE.
    rv = |{ rv } icase:{ s }|.
  ENDMETHOD.
ENDCLASS.
