CLASS zcl_gogen_t_stredge DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS mixed RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS regex RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS split RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS raising RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_stredge IMPLEMENTATION.
  METHOD run.
    rv = |{ mixed( ) } { regex( ) } { split( ) } { raising( ) }|.
  ENDMETHOD.

  METHOD mixed.
    DATA c10 TYPE c LENGTH 10.
    DATA c4 TYPE c LENGTH 4.
    DATA c3 TYPE c LENGTH 3.
    rv = |n1 m:{ to_mixed( val = `HELLO_WORLD` ) }/{ to_mixed( val = `_a__b_` ) }/{ to_mixed( val = `ab_cd` case = 'A' ) }/{ to_mixed( val = `ab-cd` sep = '-' ) }/{ to_mixed( val = `ab_cd_ef` min = 3 ) }/{ to_mixed( val = `a1_2b_c` ) }|.
    rv = |{ rv } lc:{ to_mixed( val = `HELLO_WORLD` case = 'a' ) }|.
    c10 = 'ab'.
    REPLACE FIRST OCCURRENCE OF `a` IN c10 WITH `xx`.
    rv = |{ rv } cblank:[{ c10 }]/{ sy-subrc }|.
    c4 = 'ab'.
    REPLACE FIRST OCCURRENCE OF `a` IN c4 WITH `xxx`.
    rv = |{ rv } cfull:[{ c4 }]/{ sy-subrc }|.
    c3 = 'a'.
    REPLACE ALL OCCURRENCES OF REGEX ` +$` IN c3 WITH `-`.
    rv = |{ rv } crx:[{ c3 }]/{ sy-subrc }|.
    c3 = 'ab'.
    REPLACE FIRST OCCURRENCE OF `b` IN c3 WITH ``.
    rv = |{ rv } cdel:[{ c3 }]/{ sy-subrc }|.
    c3 = 'a'.
    REPLACE ALL OCCURRENCES OF REGEX `a *` IN c3 WITH `-`.
    rv = |{ rv } crx2:[{ c3 }]/{ sy-subrc }|.
    c10 = 'ab'.
    REPLACE ALL OCCURRENCES OF ` ` IN c10 WITH `-`.
    rv = |{ rv } cfield:[{ c10 }]/{ sy-subrc }|.
  ENDMETHOD.

  METHOD regex.
    DATA s TYPE string.
    s = `ab`.
    REPLACE ALL OCCURRENCES OF REGEX `(a)` IN s WITH `\$1[$1]`.
    rv = |n2 esc:{ s }|.
    s = `ab`.
    REPLACE ALL OCCURRENCES OF REGEX `(a)` IN s WITH `$&.$9.`.
    rv = |{ rv } amp:{ s }|.
    s = |a\nb|.
    FIND REGEX `^b` IN s.
    rv = |{ rv } find:{ sy-subrc }|.
    REPLACE ALL OCCURRENCES OF REGEX `^` IN s WITH `-`.
    rv = |{ rv } repl:{ replace( val = s sub = |\n| with = `#` occ = 0 ) }|.
    s = |a\nb|.
    REPLACE ALL OCCURRENCES OF REGEX `$` IN s WITH `-`.
    rv = |{ rv } dollar:{ replace( val = s sub = |\n| with = `#` occ = 0 ) }|.
    s = `bb`.
    REPLACE ALL OCCURRENCES OF REGEX `b*` IN s WITH `-`.
    rv = |{ rv } bb:{ s }|.
    s = ``.
    REPLACE ALL OCCURRENCES OF REGEX `x*` IN s WITH `-`.
    rv = |{ rv } empty:[{ s }]/{ sy-subrc }|.
    s = `abc`.
    REPLACE FIRST OCCURRENCE OF REGEX `x*` IN s WITH `-`.
    rv = |{ rv } firstempty:{ s }/{ sy-subrc }|.
    s = `aXa`.
    REPLACE ALL OCCURRENCES OF REGEX `x` IN s WITH `-` IGNORING CASE.
    rv = |{ rv } rxicase:{ s }|.
  ENDMETHOD.

  METHOD split.
    DATA x TYPE string.
    DATA y TYPE string.
    DATA z TYPE string.
    DATA c10 TYPE c LENGTH 10.
    DATA c5 TYPE c LENGTH 5.
    DATA t TYPE string_table.
    SPLIT `a b` AT 'a ' INTO x y.
    rv = |n4 csep:[{ x }]/[{ y }]|.
    SPLIT `a  b` AT '  ' INTO x y z.
    rv = |{ rv } c2sep:[{ x }]/[{ y }]/[{ z }]|.
    c10 = 'a b'.
    z = `z`.
    SPLIT c10 AT space INTO x y z.
    rv = |{ rv } csrc:[{ x }]/[{ y }]/[{ z }]|.
    SPLIT c10 AT space INTO TABLE t.
    rv = |{ rv } ctab:{ lines( t ) }|.
    SPLIT `abc` AT `` INTO TABLE t.
    rv = |{ rv } etab:{ lines( t ) }|.
    SPLIT `a b` AT space INTO TABLE t.
    rv = |{ rv } stab:{ lines( t ) }|.
    c5 = 'x'.
    SPLIT `ab x cd` AT c5 INTO x y.
    rv = |{ rv } cvar:[{ x }]/[{ y }]|.
    SPLIT `abc` AT `` INTO x y.
    rv = |{ rv } splitempty:{ x }/{ y }/{ sy-subrc }|.
  ENDMETHOD.

  METHOD raising.
    DATA s TYPE string.
    DATA n TYPE i.
    s = `abc`.
    REPLACE FIRST OCCURRENCE OF `` IN s WITH `-`.
    rv = |replfirstempty:{ s }/{ sy-subrc }|.
    n = -1.
    TRY.
        rv = |{ rv } repneg:{ repeat( val = `a` occ = n ) }|.
      CATCH cx_sy_strg_par_val.
        rv = |{ rv } repneg:CX_SY_STRG_PAR_VAL|.
    ENDTRY.
    TRY.
        rv = |{ rv } replfnempty:{ replace( val = `abc` sub = `` with = `-` occ = 0 ) }|.
      CATCH cx_sy_strg_par_val.
        rv = |{ rv } replfnempty:CX_SY_STRG_PAR_VAL|.
    ENDTRY.
    TRY.
        rv = |{ rv } shiftneg:{ shift_left( val = `abc` places = n ) }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } shiftneg:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    n = 5.
    TRY.
        rv = |{ rv } shiftbig:{ shift_left( val = `abc` places = n ) }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } shiftbig:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    TRY.
        rv = |{ rv } r:{ shift_right( val = `abc` places = n ) }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } r:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    TRY.
        rv = |{ rv } src5:{ shift_right( val = `abc` circular = n ) }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } src5:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    n = 3.
    rv = |{ rv } slc3:{ shift_left( val = `abc` circular = n ) }|.
    n = 4.
    TRY.
        rv = |{ rv } slc4:{ shift_left( val = `abc` circular = n ) }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } slc4:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    s = `abc`.
    n = 5.
    TRY.
        REPLACE ALL OCCURRENCES OF `b` IN SECTION OFFSET n OF s WITH `-`.
        rv = |{ rv } sectbig:{ s }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } sectbig:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
    n = 2.
    REPLACE ALL OCCURRENCES OF `b` IN SECTION OFFSET 1 LENGTH n OF s WITH `-`.
    rv = |{ rv } sectok:{ s }/{ sy-subrc }|.
    s = `abc`.
    n = 5.
    TRY.
        REPLACE ALL OCCURRENCES OF `b` IN SECTION OFFSET 1 LENGTH n OF s WITH `-`.
        rv = |{ rv } sectlong:{ s }|.
      CATCH cx_sy_range_out_of_bounds.
        rv = |{ rv } sectlong:CX_SY_RANGE_OUT_OF_BOUNDS|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
