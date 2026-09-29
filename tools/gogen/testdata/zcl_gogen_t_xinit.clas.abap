CLASS zcl_gogen_t_xinit DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_s,
             a TYPE i,
             x TYPE x LENGTH 2,
             d TYPE d,
             t TYPE t,
             n TYPE n LENGTH 3,
             p TYPE p LENGTH 8 DECIMALS 2,
           END OF ty_s.
    TYPES: BEGIN OF ty_o,
             s TYPE ty_s,
             c TYPE c LENGTH 1,
           END OF ty_o.
    CONSTANTS lc_ff TYPE x LENGTH 2 VALUE 'FFFF'.
    CLASS-DATA gv_x TYPE x LENGTH 2.
    DATA mv_x TYPE x LENGTH 2.
    DATA mv_d TYPE d.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    TYPES ty_x1 TYPE x LENGTH 1.
    CLASS-METHODS ret RETURNING VALUE(rv) TYPE ty_x1.
ENDCLASS.

CLASS zcl_gogen_t_xinit IMPLEMENTATION.
  METHOD ret.
  ENDMETHOD.
  METHOD run.
    DATA ls TYPE ty_s.
    DATA lo TYPE ty_o.
    DATA lt TYPE STANDARD TABLE OF ty_s WITH DEFAULT KEY.
    DATA lv_xs TYPE xstring.
    DATA lv_i TYPE i.
    DATA lv_d TYPE d.
    DATA lv_t TYPE t.
    DATA lv_n TYPE n LENGTH 3.
    DATA lv_p TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_r TYPE x LENGTH 1.
    DATA lr TYPE REF TO zcl_gogen_t_xinit.
    CONCATENATE lv_xs ls-x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |s:{ lv_i }|.
    ls-a = 1.
    ls-x = lc_ff.
    CLEAR ls.
    APPEND ls TO lt.
    READ TABLE lt INTO ls INDEX 1.
    CLEAR lv_xs.
    CONCATENATE lv_xs ls-x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } row:{ lv_i }|.
    CLEAR lv_xs.
    CONCATENATE lv_xs gv_x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } static:{ lv_i }|.
    CREATE OBJECT lr.
    CLEAR lv_xs.
    CONCATENATE lv_xs lr->mv_x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } inst:{ lv_i } { lr->mv_d }|.
    CLEAR lv_xs.
    CONCATENATE lv_xs lo-s-x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } nested:{ lv_i } { lo-s-d } { lo-s-t } { lo-s-n } { lo-s-p }|.
    rv = |{ rv } comp:{ ls-d } { ls-t } { ls-n } { ls-p }|.
    rv = |{ rv } loc:{ lv_d } { lv_t } { lv_n } { lv_p }|.
    lv_r = ret( ).
    CLEAR lv_xs.
    CONCATENATE lv_xs lv_r INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } ret:{ lv_i } { lv_r }|.
    ls = VALUE #( a = 7 ).
    CLEAR lv_xs.
    CONCATENATE lv_xs ls-x INTO lv_xs IN BYTE MODE.
    lv_i = xstrlen( lv_xs ).
    rv = |{ rv } value:{ ls-a } { lv_i } { ls-d } { ls-n }|.
  ENDMETHOD.
ENDCLASS.
