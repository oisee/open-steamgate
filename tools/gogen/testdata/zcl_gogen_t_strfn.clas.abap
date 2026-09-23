CLASS zcl_gogen_t_strfn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strfn IMPLEMENTATION.
  METHOD run.
    DATA n TYPE i.
    n = 3.
    rv = |rep:{ repeat( val = `ab` occ = n ) }/[{ repeat( val = ' ' occ = 3 ) }]/[{ repeat( val = ` ` occ = 2 ) }]/[{ repeat( val = `x` occ = 0 ) }]|.
    rv = |{ rv } r1:{ replace( val = `abcabc` sub = `b` with = `-` ) }|.
    rv = |{ rv } r0:{ replace( val = `abcabc` sub = `b` with = `-` occ = 0 ) }|.
    rv = |{ rv } r2:{ replace( val = `abcabcabc` sub = `b` with = `-` occ = 2 ) }|.
    rv = |{ rv } rm1:{ replace( val = `abcabcabc` sub = `b` with = `-` occ = -1 ) }|.
    rv = |{ rv } r5:{ replace( val = `abcabc` sub = `b` with = `-` occ = 5 ) }|.
    rv = |{ rv } rq:{ replace( val = `a'b'` sub = `'` with = `''` occ = 0 ) }|.
    rv = |{ rv } rx:{ replace( val = `abcabc` regex = `b|c` with = `-` occ = 0 ) }|.
    rv = |{ rv } rxe:{ replace( val = `abc` regex = `x*` with = `-` occ = 0 ) }|.
    rv = |{ rv } rxg:{ replace( val = `abab` regex = `(a)(b)` with = `$2$1` occ = 0 ) }|.
    rv = |{ rv } rc:[{ replace( val = 'a b ' sub = 'b' with = '_ ' occ = 0 ) }]|.
  ENDMETHOD.
ENDCLASS.
