CLASS zcl_gogen_t_strcrlf DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strcrlf IMPLEMENTATION.
  METHOD run.
    DATA s TYPE string.
    s = `a` && cl_abap_char_utilities=>cr_lf && `b`.
    FIND REGEX 'a$' IN s.
    rv = |f1:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
