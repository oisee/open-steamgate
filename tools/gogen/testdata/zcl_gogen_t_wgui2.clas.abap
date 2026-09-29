* substring_before / substring_after( val sub ) (ultra/events, abapGit's
* ZCL_ABAPGIT_GUI_EVENT=>PARSE_FIELDS): the first occurrence, none, the
* separator at either end.
CLASS zcl_gogen_t_wgui2 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_wgui2 IMPLEMENTATION.
  METHOD run.
    rv = |b:[{ substring_before( val = `a=b=c` sub = '=' ) }][{ substring_before( val = `abc` sub = '=' ) }]|
      && |[{ substring_before( val = `=x` sub = '=' ) }][{ substring_before( val = `k=` sub = `=` ) }]|
      && | a:[{ substring_after( val = `a=b=c` sub = '=' ) }][{ substring_after( val = `abc` sub = '=' ) }]|
      && |[{ substring_after( val = `=x` sub = '=' ) }][{ substring_after( val = `k=` sub = `=` ) }]|
      && |[{ substring_after( val = `aXbxc` sub = 'x' ) }]|.
  ENDMETHOD.
ENDCLASS.
