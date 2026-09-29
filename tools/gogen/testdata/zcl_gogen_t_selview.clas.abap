* SELECT from a DDIC view (ultra/sadl): a view that carries MANDT is read
* like a client-dependent table, the logon client's rows only (the Open SQL
* rule for a view with a client column; not measured on A4H here). A view
* over a client-dependent table without MANDT is refused (ZCL_GOGEN_T_SELVIEWN).
CLASS zcl_gogen_t_selview DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_selview IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_row,
             id     TYPE c LENGTH 10,
             amount TYPE i,
           END OF ty_row.
    DATA ls TYPE zgogen_t_dbw.
    DATA lt TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA ls_row TYPE ty_row.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    SELECT id amount FROM zgogen_t_dbwv INTO CORRESPONDING FIELDS OF TABLE lt WHERE amount > 1 ORDER BY id.
    rv = |{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt INTO ls_row.
      rv = |{ rv } { ls_row-id }:{ ls_row-amount }|.
    ENDLOOP.
    ROLLBACK WORK.
  ENDMETHOD.
ENDCLASS.
