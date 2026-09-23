CLASS zcl_gogen_t_rqsplit DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rqsplit IMPLEMENTATION.
  METHOD run.
    DATA la TYPE string.
    DATA lb TYPE string.
    DATA lc3 TYPE c LENGTH 3.
    DATA lc3b TYPE c LENGTH 3.
    SPLIT 'Seats desc' AT space INTO la lb.
    rv = |e[{ la }][{ lb }]{ sy-subrc }|.
    SPLIT 'a  b' AT space INTO la lb.
    rv = |{ rv };f[{ la }][{ lb }]{ sy-subrc }|.
    SPLIT 'a' AT space INTO la lb.
    rv = |{ rv };g[{ la }][{ lb }]{ sy-subrc }|.
    SPLIT 'a b c' AT space INTO la lb.
    rv = |{ rv };h[{ la }][{ lb }]{ sy-subrc }|.
    SPLIT 'abcdef gh' AT space INTO lc3 lc3b.
    rv = |{ rv };i[{ lc3 }][{ lc3b }]{ sy-subrc }|.
    SPLIT 'x yyyy' AT space INTO lc3 lc3b.
    rv = |{ rv };j[{ lc3 }][{ lc3b }]{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
