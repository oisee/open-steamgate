CLASS zcl_gogen_t_strlines DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS vis IMPORTING s TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strlines IMPLEMENTATION.
  METHOD vis.
    rv = s.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv WITH '|'.
  ENDMETHOD.
  METHOD run.
    DATA: lf TYPE string, s TYPE string, c1 TYPE c LENGTH 1.
    lf = cl_abap_char_utilities=>newline.
    s = `a` && lf && lf && `b`.
    REPLACE ALL OCCURRENCES OF REGEX '^' IN s WITH '-'.
    rv = |n1:{ vis( s ) }|.
    s = `a` && lf && `b`.
    REPLACE ALL OCCURRENCES OF REGEX '$' IN s WITH '-'.
    rv = |{ rv } n2:{ vis( s ) }|.
    s = `a` && lf && lf && `b`.
    REPLACE ALL OCCURRENCES OF REGEX '$' IN s WITH '-'.
    rv = |{ rv } n3:{ vis( s ) }|.
    s = `a` && cl_abap_char_utilities=>cr_lf && `b`.
    REPLACE ALL OCCURRENCES OF REGEX '.' IN s WITH '-'.
    rv = |{ rv } dot:{ s }|.
    s = `a` && cl_abap_char_utilities=>form_feed && `b`.
    FIND REGEX 'a$' IN s.
    rv = |{ rv } ff:{ sy-subrc }|.
    FIND REGEX 'b$' IN s.
    rv = |{ rv }/{ sy-subrc }|.
    s = `a` && cl_abap_char_utilities=>vertical_tab && `b`.
    FIND REGEX 'a$' IN s.
    rv = |{ rv } vt:{ sy-subrc }|.
    rv = |{ rv } c1:[{ condense( val = ` xa  bx ` del = space ) }]|.
    rv = |{ rv } c2:[{ condense( val = `a--b` from = '-' to = space ) }]|.
    rv = |{ rv } c3:[{ condense( val = `a  b` from = space to = '-' ) }]|.
    c1 = ' '.
    rv = |{ rv } c4:[{ condense( val = ` a  b ` del = c1 ) }]|.
    rv = |{ rv } c5:[{ condense( val = ` a  b ` del = ` ` ) }]|.
    rv = |{ rv } c7:[{ condense( val = ` a  b ` del = '' ) }]|.
  ENDMETHOD.
ENDCLASS.
