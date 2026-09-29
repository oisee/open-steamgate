* What the WEBGUI's sapevent path needs besides events (ultra/events):
* line_exists( ), NS, reference comparison, SORTED tables with INSERT INTO
* TABLE, CONCATENATE (fields and LINES OF), FIND ALL
* OCCURRENCES ... MATCH COUNT (substring, REGEX, a CL_ABAP_REGEX object),
* escape( ) for HTML attributes. The field symbol of a string is in
* ZCL_GOGEN_T_WGUI3, so that the JS emitter compiles this one.
CLASS zcl_gogen_t_wgui1 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_kv,
             k TYPE string,
             v TYPE i,
           END OF ty_kv.
    TYPES ty_sorted TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY k.
    TYPES ty_c3 TYPE c LENGTH 3.
    TYPES ty_c3_tab TYPE STANDARD TABLE OF ty_c3 WITH DEFAULT KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_wgui1 IMPLEMENTATION.
  METHOD run.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lt_kv TYPE STANDARD TABLE OF ty_kv WITH DEFAULT KEY.
    DATA ls_kv TYPE ty_kv.
    DATA lt_s TYPE ty_sorted.
    DATA lo_a TYPE REF TO zcl_gogen_t_wgui1.
    DATA lo_b TYPE REF TO zcl_gogen_t_wgui1.
    DATA lo_o TYPE REF TO object.
    DATA lv_str TYPE string.
    DATA lv_c3 TYPE ty_c3.
    DATA lt_str TYPE string_table.
    DATA lt_c3 TYPE ty_c3_tab.
    DATA lv_n TYPE i.
    DATA lo_re TYPE REF TO cl_abap_regex.
    FIELD-SYMBOLS <ls_kv> TYPE ty_kv.

    APPEND 3 TO lt_i.
    APPEND 5 TO lt_i.
    ls_kv-k = `a`. ls_kv-v = 1. APPEND ls_kv TO lt_kv.
    ls_kv-k = `b`. ls_kv-v = 2. APPEND ls_kv TO lt_kv.
    rv = |le:{ xsdbool( line_exists( lt_i[ table_line = 5 ] ) ) }{ xsdbool( line_exists( lt_i[ table_line = 4 ] ) ) }|
      && |{ xsdbool( line_exists( lt_kv[ k = `b` v = 2 ] ) ) }{ xsdbool( line_exists( lt_kv[ k = `b` v = 1 ] ) ) }|
      && |{ xsdbool( line_exists( lt_kv[ v = 1 ] ) ) }{ xsdbool( NOT line_exists( lt_kv[ k = `z` ] ) ) }|.

    rv = |{ rv } ns:{ xsdbool( 'abc' NS 'x' ) }{ xsdbool( 'abc' NS 'B' ) }{ xsdbool( 'abc' CN 'abc' ) }{ xsdbool( 'abd' CN 'abc' ) }|.

    rv = |{ rv } ref:{ xsdbool( lo_a = lo_b ) }|.
    CREATE OBJECT lo_a.
    rv = |{ rv }{ xsdbool( lo_a = lo_b ) }|.
    lo_b = lo_a.
    rv = |{ rv }{ xsdbool( lo_a = lo_b ) }|.
    lo_o = lo_a.
    rv = |{ rv }{ xsdbool( lo_o = lo_a ) }|.
    CREATE OBJECT lo_b.
    rv = |{ rv }{ xsdbool( lo_a <> lo_b ) }|.

    ls_kv-k = `m`. ls_kv-v = 1. INSERT ls_kv INTO TABLE lt_s.
    rv = |{ rv } so:{ sy-subrc }/{ sy-tabix }|.
    ls_kv-k = `c`. ls_kv-v = 2. INSERT ls_kv INTO TABLE lt_s.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    ls_kv-k = `x`. ls_kv-v = 3. INSERT ls_kv INTO TABLE lt_s.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    ls_kv-k = `c`. ls_kv-v = 4. INSERT ls_kv INTO TABLE lt_s.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    ls_kv-k = `B`. ls_kv-v = 5. INSERT ls_kv INTO TABLE lt_s.
    rv = |{ rv },{ sy-subrc }/{ sy-tabix }|.
    LOOP AT lt_s INTO ls_kv.
      rv = |{ rv } { ls_kv-k }{ ls_kv-v }|.
    ENDLOOP.
    READ TABLE lt_s ASSIGNING <ls_kv> WITH KEY k = `x`.
    rv = |{ rv } rd:{ sy-subrc }/{ sy-tabix }|.

    CLEAR lt_str.
    APPEND `p!` TO lt_str.
    APPEND `r!` TO lt_str.

    CONCATENATE 'ab ' `cd ` 'e' INTO lv_str.
    rv = |{ rv } cc:[{ lv_str }]|.
    CONCATENATE 'ab ' 'cd' INTO lv_str SEPARATED BY space.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE 'ab ' 'cd' INTO lv_str SEPARATED BY '- '.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE 'ab ' 'cd' INTO lv_str RESPECTING BLANKS.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE 'ab' 'cd' INTO lv_c3.
    rv = |{ rv }[{ lv_c3 }]{ sy-subrc }|.
    CONCATENATE 'a' 'b' INTO lv_c3.
    rv = |{ rv }[{ lv_c3 }]{ sy-subrc }|.
    CONCATENATE lv_str 'x' INTO lv_str IN CHARACTER MODE.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE LINES OF lt_str INTO lv_str SEPARATED BY `/`.
    rv = |{ rv } cl:[{ lv_str }]|.
    APPEND 'a ' TO lt_c3.
    APPEND 'b' TO lt_c3.
    CONCATENATE LINES OF lt_c3 INTO lv_str.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE LINES OF lt_c3 INTO lv_str RESPECTING BLANKS.
    rv = |{ rv }[{ lv_str }]|.
    CONCATENATE LINES OF lt_c3 INTO lv_str SEPARATED BY space.
    rv = |{ rv }[{ lv_str }]|.
    CLEAR lt_c3.
    lv_str = `keep`.
    CONCATENATE LINES OF lt_c3 INTO lv_str.
    rv = |{ rv }[{ lv_str }]{ sy-subrc }|.

    lv_n = 7.
    FIND ALL OCCURRENCES OF '<' IN `<a><b></b>` MATCH COUNT lv_n.
    rv = |{ rv } fa:{ lv_n }/{ sy-subrc }|.
    FIND ALL OCCURRENCES OF '</' IN `<a><b></b>` MATCH COUNT lv_n.
    rv = |{ rv },{ lv_n }/{ sy-subrc }|.
    lv_n = 7.
    FIND ALL OCCURRENCES OF '{' IN `abc` MATCH COUNT lv_n.
    rv = |{ rv },{ lv_n }/{ sy-subrc }|.
    FIND ALL OCCURRENCES OF 'aa' IN `aaaaa` MATCH COUNT lv_n.
    rv = |{ rv },{ lv_n }|.
    FIND ALL OCCURRENCES OF REGEX '<(BR|HR)' IN `<BR><HR><B>` MATCH COUNT lv_n.
    rv = |{ rv },{ lv_n }|.
    CREATE OBJECT lo_re EXPORTING pattern = '<(AREA|BR|INPUT|!)' ignore_case = abap_false.
    FIND ALL OCCURRENCES OF REGEX lo_re IN `<INPUT x><!-- c --><br>` MATCH COUNT lv_n.
    rv = |{ rv },{ lv_n }|.

    lv_str = escape( val = `a<b>"c'&d e` format = cl_abap_format=>e_html_attr ).
    rv = |{ rv } esc:{ lv_str }|.
  ENDMETHOD.
ENDCLASS.
