CLASS zcl_gogen_t_findsec DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS run2 RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS run1 RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS sec IMPORTING iv_off TYPE i iv_len TYPE i iv_mode TYPE i iv_pat TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_findsec IMPLEMENTATION.
  METHOD sec.
    DATA s TYPE string.
    DATA o TYPE i.
    DATA l TYPE i.
    s = `ab<cd<e`.
    o = 99.
    l = 98.
    TRY.
        CASE iv_mode.
          WHEN 1.
            FIND FIRST OCCURRENCE OF iv_pat IN SECTION OFFSET iv_off OF s MATCH OFFSET o MATCH LENGTH l.
          WHEN 2.
            FIND iv_pat IN SECTION OFFSET iv_off LENGTH iv_len OF s MATCH OFFSET o MATCH LENGTH l.
          WHEN 3.
            FIND iv_pat IN SECTION LENGTH iv_len OF s MATCH OFFSET o MATCH LENGTH l.
        ENDCASE.
        rv = |{ sy-subrc }/{ o }/{ l }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = `\CLASS=CX_SY_RANGE_OUT_OF_BOUNDS`.
    ENDTRY.
  ENDMETHOD.

  METHOD run.
    rv = |{ run1( ) } { run2( ) }|.
  ENDMETHOD.

  METHOD run1.
    DATA t TYPE string_table.
    DATA t2 TYPE string_table.
    DATA t0 TYPE string_table.
    DATA f TYPE string.
    DATA f2 TYPE string.
    DATA ln TYPE i.
    DATA o TYPE i.
    rv = |a:{ sec( iv_off = 3 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } b:{ sec( iv_off = 2 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } c:{ sec( iv_off = 6 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } d:{ sec( iv_off = 7 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } e:{ sec( iv_off = 8 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } f:{ sec( iv_off = -1 iv_len = 0 iv_mode = 1 iv_pat = `<` ) }|.
    rv = |{ rv } g:{ sec( iv_off = 3 iv_len = 2 iv_mode = 2 iv_pat = `<` ) }|.
    rv = |{ rv } h:{ sec( iv_off = 3 iv_len = 3 iv_mode = 2 iv_pat = `<` ) }|.
    rv = |{ rv } i:{ sec( iv_off = 0 iv_len = 2 iv_mode = 3 iv_pat = `<` ) }|.
    rv = |{ rv } j:{ sec( iv_off = 0 iv_len = 3 iv_mode = 3 iv_pat = `<` ) }|.
    rv = |{ rv } k:{ sec( iv_off = 5 iv_len = 3 iv_mode = 2 iv_pat = `<` ) }|.
    rv = |{ rv } l:{ sec( iv_off = 0 iv_len = -1 iv_mode = 3 iv_pat = `<` ) }|.
    rv = |{ rv } m:{ sec( iv_off = 2 iv_len = 0 iv_mode = 2 iv_pat = `<` ) }|.
    rv = |{ rv } n:{ sec( iv_off = 3 iv_len = 2 iv_mode = 2 iv_pat = `cd<` ) }|.
    rv = |{ rv } p:{ sec( iv_off = 1 iv_len = 0 iv_mode = 1 iv_pat = `` ) }|.
    rv = |{ rv } p2:{ sec( iv_off = 7 iv_len = 0 iv_mode = 1 iv_pat = `e` ) }|.
    rv = |{ rv } p3:{ sec( iv_off = 6 iv_len = 1 iv_mode = 2 iv_pat = `e` ) }|.

    APPEND `x` TO t.
    APPEND `a @Aggregation.default: #SUM` TO t.
    APPEND `@aggregation.default:#max` TO t.
    f = `keep`. ln = 99. o = 99.
    FIND REGEX '@Aggregation\.default:\s*#(\w+)' IN TABLE t IGNORING CASE SUBMATCHES f MATCH LINE ln MATCH OFFSET o.
    rv = |{ rv } q:{ sy-subrc }/{ f }/{ ln }/{ o }|.
    f = `keep`. ln = 99. o = 99.
    FIND REGEX 'aggregation\.default:\s*#(\w+)' IN TABLE t SUBMATCHES f MATCH LINE ln MATCH OFFSET o.
    rv = |{ rv } r:{ sy-subrc }/{ f }/{ ln }/{ o }|.
    f = `keep`. ln = 99.
    FIND REGEX 'zzz(\w)' IN TABLE t SUBMATCHES f MATCH LINE ln.
    rv = |{ rv } s:{ sy-subrc }/{ f }/{ ln }|.
    f = `keep`. f2 = `keep`.
    FIND REGEX '(a)|(q)' IN TABLE t SUBMATCHES f2 f.
    rv = |{ rv } s2:{ sy-subrc }/{ f2 }/{ f }|.
    f = `keep`. ln = 99.
    FIND REGEX 'x(\w)' IN TABLE t0 SUBMATCHES f MATCH LINE ln.
    rv = |{ rv } u:{ sy-subrc }/{ f }/{ ln }|.
    APPEND `ab` TO t2.
    APPEND `cd` TO t2.
    ln = 99.
    FIND 'bc' IN TABLE t2 MATCH LINE ln.
    rv = |{ rv } v:{ sy-subrc }/{ ln }|.
    ln = 99. o = 99.
    FIND 'd' IN TABLE t2 MATCH LINE ln MATCH OFFSET o.
    rv = |{ rv } w:{ sy-subrc }/{ ln }/{ o }|.
    ln = 99. o = 99.
    FIND 'D' IN TABLE t2 IGNORING CASE MATCH LINE ln MATCH OFFSET o.
    rv = |{ rv } w2:{ sy-subrc }/{ ln }/{ o }|.
  ENDMETHOD.
  METHOD run2.
    DATA s TYPE string.
    DATA o TYPE i.
    DATA l TYPE i.
    s = `abc`.
    o = 99. l = 98.
    FIND `` IN s MATCH OFFSET o MATCH LENGTH l.
    rv = |x1:{ sy-subrc }/{ o }/{ l }|.
    o = 99. l = 98.
    FIND FIRST OCCURRENCE OF '' IN s MATCH OFFSET o MATCH LENGTH l.
    rv = |{ rv } x2:{ sy-subrc }/{ o }/{ l }|.
    rv = |{ rv } l3:{ sec( iv_off = 0 iv_len = -3 iv_mode = 3 iv_pat = `<` ) }|.
    rv = |{ rv } l4:{ sec( iv_off = 3 iv_len = -1 iv_mode = 2 iv_pat = `<` ) }|.
    rv = |{ rv } l5:{ sec( iv_off = 7 iv_len = 0 iv_mode = 2 iv_pat = `` ) }|.
    rv = |{ rv } l6:{ sec( iv_off = 7 iv_len = 0 iv_mode = 1 iv_pat = `` ) }|.
  ENDMETHOD.
ENDCLASS.
