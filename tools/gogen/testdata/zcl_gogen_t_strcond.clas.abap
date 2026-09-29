CLASS zcl_gogen_t_strcond DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_strcond IMPLEMENTATION.
  METHOD run.
    rv = |c:[{ condense( `  a   b  ` ) }]|.
    rv = |{ rv } cd:[{ condense( val = `xxaxxbyyx` del = `x` from = `xy` to = `-` ) }]|.
    rv = |{ rv } cdel:[{ condense( val = `  a  b ` del = `` ) }]|.
    rv = |{ rv } cfrom:[{ condense( val = ` a  b ` from = `` ) }]|.
    rv = |{ rv } cto:[{ condense( val = ` a  b ` to = `` ) }]|.
    rv = |{ rv } cc:[{ condense( val = ' a  b ' ) }]|.
    rv = |{ rv } cto2:[{ condense( val = ` a  b ` to = `xy` ) }]|.
    rv = |{ rv } cdel2:[{ condense( val = `abxaba` del = `ab` ) }]|.
    rv = |{ rv } sl:{ shift_left( val = `abcde` places = 2 ) }/[{ shift_left( val = `  ab ` ) }]/{ shift_left( val = `ababx` sub = `ab` ) }/{ shift_left( val = `abc` circular = 1 ) }|.
    rv = |{ rv } sr:{ shift_right( val = `abcde` places = 2 ) }/[{ shift_right( val = ` ab  ` ) }]/{ shift_right( val = `xabab` sub = `ab` ) }/{ shift_right( val = `abc` circular = 1 ) }|.
    rv = |{ rv } slc:[{ shift_left( val = `  ab` sub = ` ` ) }]/[{ shift_left( val = 'xxab' sub = 'x' ) }]/{ shift_left( val = `abc` places = 3 ) }/{ shift_right( val = `abc` circular = 3 ) }|.
  ENDMETHOD.
ENDCLASS.
