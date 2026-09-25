CLASS zcl_gogen_t_findres DEFINITION PUBLIC FINAL CREATE PUBLIC.
* FIND ... RESULTS into a match_result / match_result_tab (open-abap-core's
* CL_ABAP_MATCHER, CL_IXML; abapGit's highlighter goes through the
* matcher): offsets, lengths and submatches, and what the engines differ in
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS tab
      IMPORTING it_res    TYPE match_result_tab
      RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS one
      IMPORTING is_res    TYPE match_result
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_findres IMPLEMENTATION.
  METHOD one.
    DATA ls_sub TYPE submatch_result.
    rv = |{ is_res-line }:{ is_res-offset },{ is_res-length }|.
    LOOP AT is_res-submatches INTO ls_sub.
      rv = |{ rv }({ ls_sub-offset },{ ls_sub-length })|.
    ENDLOOP.
  ENDMETHOD.

  METHOD tab.
    DATA ls_res TYPE match_result.
    rv = |{ lines( it_res ) }[|.
    LOOP AT it_res INTO ls_res.
      rv = |{ rv }{ one( ls_res ) };|.
    ENDLOOP.
    rv = |{ rv }]|.
  ENDMETHOD.

  METHOD run.
    DATA lt_res TYPE match_result_tab.
    DATA ls_res TYPE match_result.
    DATA lv_s TYPE string.

    FIND ALL OCCURRENCES OF REGEX 'a|ab' IN 'xabab' RESULTS lt_res.
    rv = |alt:{ sy-subrc }/{ tab( lt_res ) }|.
    FIND FIRST OCCURRENCE OF REGEX '(a)|(b)' IN 'xb' RESULTS ls_res.
    rv = |{ rv } grp:{ sy-subrc }/{ one( ls_res ) }|.
    FIND ALL OCCURRENCES OF REGEX '((a)(b))' IN 'abab' RESULTS lt_res.
    rv = |{ rv } nest:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF REGEX '\bab\b' IN 'ab cab ab' RESULTS lt_res.
    rv = |{ rv } wb:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF 'aa' IN 'aaaaa' RESULTS lt_res.
    rv = |{ rv } sub:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF REGEX 'AB' IN 'xAbab' IGNORING CASE RESULTS lt_res.
    rv = |{ rv } ic:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF 'b' IN 'aébé' RESULTS lt_res.
    rv = |{ rv } uni:{ tab( lt_res ) }|.
    FIND REGEX 'b(c)?' IN 'abd' RESULTS ls_res.
    rv = |{ rv } opt:{ sy-subrc }/{ one( ls_res ) }|.
    FIND ALL OCCURRENCES OF REGEX 'a(b)?' IN 'aab' RESULTS lt_res.
    rv = |{ rv } opt2:{ tab( lt_res ) }|.
    ls_res-offset = 7.
    FIND FIRST OCCURRENCE OF 'zz' IN 'abc' RESULTS ls_res.
    rv = |{ rv } miss1:{ sy-subrc }/{ one( ls_res ) }|.
    FIND ALL OCCURRENCES OF 'a' IN 'aa' RESULTS lt_res.
    FIND ALL OCCURRENCES OF 'zz' IN 'abc' RESULTS lt_res.
    rv = |{ rv } missall:{ sy-subrc }/{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF REGEX 'x*' IN 'abc' RESULTS lt_res.
    rv = |{ rv } empty:{ sy-subrc }/{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF REGEX 'b*' IN 'abbc' RESULTS lt_res.
    rv = |{ rv } empty2:{ sy-subrc }/{ tab( lt_res ) }|.
    lv_s = 'one two'.
    FIND ALL OCCURRENCES OF REGEX '(\w+)' IN lv_s RESULTS lt_res.
    rv = |{ rv } w:{ tab( lt_res ) }|.
    FIND ALL OCCURRENCES OF REGEX '(a|ab)(c|bcd)' IN 'abcd' RESULTS lt_res.
    rv = |{ rv } posix:{ tab( lt_res ) }|.
  ENDMETHOD.
ENDCLASS.
