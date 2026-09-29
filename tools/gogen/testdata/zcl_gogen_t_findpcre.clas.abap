CLASS zcl_gogen_t_findpcre DEFINITION PUBLIC FINAL CREATE PUBLIC.
* FIND ALL OCCURRENCES OF PCRE ... RESULTS: leftmost-first (a|ab takes a),
* lazy quantifiers, empty matches as REGEX has them
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS tab
      IMPORTING it_res    TYPE match_result_tab
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_findpcre IMPLEMENTATION.
  METHOD tab.
    DATA ls_res TYPE match_result.
    DATA ls_sub TYPE submatch_result.
    rv = |{ lines( it_res ) }[|.
    LOOP AT it_res INTO ls_res.
      rv = |{ rv }{ ls_res-offset },{ ls_res-length }|.
      LOOP AT ls_res-submatches INTO ls_sub.
        rv = |{ rv }({ ls_sub-offset },{ ls_sub-length })|.
      ENDLOOP.
      rv = |{ rv };|.
    ENDLOOP.
    rv = |{ rv }]|.
  ENDMETHOD.

  METHOD run.
    DATA lt_res TYPE match_result_tab.
    FIND ALL OCCURRENCES OF PCRE 'a|ab' IN 'xabab' RESULTS lt_res.
    rv = |alt:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE '(a|ab)(c|bcd)' IN 'abcd' RESULTS lt_res.
    rv = |{ rv } grp:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE 'b*' IN 'abbc' RESULTS lt_res.
    rv = |{ rv } empty:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE '\bab\b' IN 'ab cab ab' RESULTS lt_res.
    rv = |{ rv } wb:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE '(x)?b' IN 'ab' RESULTS lt_res.
    rv = |{ rv } opt:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE 'a+?' IN 'aaa' RESULTS lt_res.
    rv = |{ rv } lazy:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF PCRE 'AB' IN 'xAbab' IGNORING CASE RESULTS lt_res.
    rv = |{ rv } ic:{ tab( lt_res ) }|.
  ENDMETHOD.
ENDCLASS.
