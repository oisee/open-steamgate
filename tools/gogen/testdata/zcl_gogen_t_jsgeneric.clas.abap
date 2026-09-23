CLASS zcl_gogen_t_jsgeneric DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             name TYPE string,
             n    TYPE i,
           END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_flat,
             a TYPE i,
             b TYPE c LENGTH 2,
           END OF ty_flat.
    CLASS-DATA gv_log TYPE string.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS kind IMPORTING ix TYPE any RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS sup IMPORTING ia TYPE i OPTIONAL ib TYPE string OPTIONAL RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS note IMPORTING iv TYPE any.
ENDCLASS.

CLASS zcl_gogen_t_jsgeneric IMPLEMENTATION.
  METHOD kind.
    DESCRIBE FIELD ix TYPE rv.
  ENDMETHOD.

  METHOD sup.
    rv = 'a-'.
    IF ia IS SUPPLIED.
      rv = 'A+'.
    ENDIF.
    IF ib IS NOT SUPPLIED.
      rv = |{ rv }b-|.
    ELSE.
      rv = |{ rv }B+|.
    ENDIF.
  ENDMETHOD.

  METHOD note.
    gv_log = |{ gv_log }<{ iv }>|.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE ty_row.
    DATA lt TYPE ty_rows.
    DATA lv_i TYPE i.
    DATA lv_f TYPE f.
    DATA lv_s TYPE string.
    DATA lv_c TYPE c LENGTH 3.
    DATA lv_x TYPE x LENGTH 2.
    DATA lv_d TYPE d.
    DATA lv_t TYPE t.
    DATA lr TYPE REF TO data.
    DATA lr0 TYPE REF TO data.
    DATA lv_k TYPE c LENGTH 1.
    DATA lv_name TYPE string.
    DATA lf TYPE ty_flat.
    FIELD-SYMBOLS <c> TYPE any.
    FIELD-SYMBOLS <r> TYPE any.
    FIELD-SYMBOLS <t> TYPE ANY TABLE.

    " ASSIGN COMPONENT: read, write back, lower case, unknown
    ls-name = 'x'.
    ls-n = 1.
    ASSIGN COMPONENT 'N' OF STRUCTURE ls TO <c>.
    rv = |comp:{ sy-subrc }/{ <c> }|.
    <c> = 5.
    rv = |{ rv }/{ ls-n }|.
    ASSIGN COMPONENT 'name' OF STRUCTURE ls TO <c>.
    IF sy-subrc = 0.
      <c> = 'low'.
    ENDIF.
    rv = |{ rv }/{ sy-subrc }/{ ls-name }|.
    ASSIGN COMPONENT 'NOPE' OF STRUCTURE ls TO <c>.
    rv = |{ rv }/{ sy-subrc }/{ <c> }|.

    " LOOP over ANY TABLE, a write through the field symbol
    ls-name = 'p'.
    ls-n = 1.
    APPEND ls TO lt.
    ls-name = 'q'.
    ls-n = 2.
    APPEND ls TO lt.
    ASSIGN lt TO <t>.
    rv = |{ rv } lines:{ lines( <t> ) }|.
    LOOP AT <t> ASSIGNING <r>.
      ASSIGN COMPONENT 'N' OF STRUCTURE <r> TO <c>.
      lv_i = <c>.
      lv_i = lv_i * 10 + sy-tabix.
      <c> = lv_i.
    ENDLOOP.
    LOOP AT lt INTO ls.
      rv = |{ rv } { ls-name }{ ls-n }|.
    ENDLOOP.

    " DESCRIBE FIELD kinds, direct and through TYPE any
    DESCRIBE FIELD lv_i TYPE lv_k.
    rv = |{ rv } kinds:{ lv_k }|.
    rv = |{ rv }{ kind( lv_f ) }{ kind( lv_s ) }{ kind( lv_c ) }{ kind( lv_x ) }{ kind( lv_d ) }{ kind( lv_t ) }|.
    rv = |{ rv }{ kind( ls ) }{ kind( lt ) }{ kind( lr ) }|.

    " GET REFERENCE + ->*, an initial reference
    lv_i = 3.
    GET REFERENCE OF lv_i INTO lr.
    ASSIGN lr->* TO <c>.
    rv = |{ rv } ref:{ sy-subrc }/{ <c> }|.
    <c> = 42.
    rv = |{ rv }/{ lv_i }|.
    ASSIGN lr0->* TO <r>.
    rv = |{ rv }/{ sy-subrc }|.
    IF <r> IS ASSIGNED.
      rv = |{ rv }/asg|.
    ELSE.
      rv = |{ rv }/unasg|.
    ENDIF.
    IF lr0 IS INITIAL.
      rv = |{ rv }/ini|.
    ENDIF.
    IF lr IS NOT INITIAL.
      rv = |{ rv }/set|.
    ENDIF.

    " IS INITIAL of a generic value
    ASSIGN COMPONENT 'NAME' OF STRUCTURE ls TO <c>.
    IF <c> IS NOT INITIAL.
      rv = |{ rv } notini|.
    ENDIF.
    CLEAR ls-name.
    IF <c> IS INITIAL.
      rv = |{ rv }/ini|.
    ENDIF.

    " IS SUPPLIED
    rv = |{ rv } sup:{ sup( ) }{ sup( ia = 1 ) }{ sup( ib = `z` ) }{ sup( ia = 0 ib = `` ) }|.

    " CALL METHOD (class)=>m
    lv_name = 'ZCL_GOGEN_T_JSGENERIC'.
    lv_s = `d1`.
    CALL METHOD (lv_name)=>note EXPORTING iv = lv_s.
    lv_i = 7.
    CALL METHOD (lv_name)=>note EXPORTING iv = lv_i.
    TRY.
        CALL METHOD ('ZCL_GOGEN_T_NOPE')=>note EXPORTING iv = lv_s.
      CATCH cx_sy_dyn_call_illegal_class.
        gv_log = |{ gv_log }<noclass>|.
    ENDTRY.
    rv = |{ rv } dyn:{ gv_log }|.

    " a flat structure; a binding outlives a move into its structure;
    " whole rows, c fitting, i into a string, CLEAR through generic data
    rv = |{ rv } flat:{ kind( lf ) }|.
    ASSIGN COMPONENT 'N' OF STRUCTURE ls TO <c>.
    ls = VALUE #( name = `m` n = 8 ).
    <c> = 9.
    rv = |{ rv } moved:{ ls-name }{ ls-n }|.
    ASSIGN ls TO <c>.
    LOOP AT <t> ASSIGNING <r>.
      <r> = <c>.
      EXIT.
    ENDLOOP.
    LOOP AT lt INTO ls.
      rv = |{ rv } { ls-name }{ ls-n }|.
    ENDLOOP.
    ASSIGN COMPONENT 'B' OF STRUCTURE lf TO <c>.
    <c> = `xyz`.
    ASSIGN COMPONENT 'NAME' OF STRUCTURE ls TO <r>.
    <r> = -5.
    rv = |{ rv } fit:{ lf-b }/{ ls-name }/|.
    CLEAR <r>.
    CLEAR <t>.
    IF <t> IS INITIAL AND ls-name IS INITIAL.
      rv = |{ rv }cleared:{ lines( lt ) }|.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
