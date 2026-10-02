CLASS zcl_gogen_t_ipowtext DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_ipowtext IMPLEMENTATION.
  METHOD run.
    DATA b TYPE int8 VALUE 42.
    DATA s TYPE string.
    DATA lv_c TYPE c LENGTH 1 VALUE '3'.
    DATA lv_n TYPE n LENGTH 1 VALUE '3'.
    DATA v TYPE i.
    DATA small TYPE i VALUE -5.
    s = `a` && b.
    rv = s && `/`.
    s = b && `a`.
    rv = rv && s && `/`.
    s = `a` && b && `a`.
    rv = rv && s && `/`.
    b = -5.
    s = `a` && b.
    rv = rv && s.
    v = 1 + ipow( base = lv_c exp = 2 ).
    rv = rv && |/c:{ v }|.
    v = 1 + ipow( base = lv_n exp = 2 ).
    rv = rv && |/n:{ v }|.
    s = small.
    rv = rv && `/` && s.
    small = -2147483648.
    s = small.
    rv = rv && `/` && s.
  ENDMETHOD.
ENDCLASS.
