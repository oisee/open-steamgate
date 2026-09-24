* a view over a client-dependent table that leaves MANDT out: refused at
* build time (NOT_COMPILED when reached), not read across clients
CLASS zcl_gogen_t_selviewn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_selviewn IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE STANDARD TABLE OF zgogen_t_dbwn WITH DEFAULT KEY.
    SELECT * FROM zgogen_t_dbwn INTO TABLE lt.
    rv = |n:{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
