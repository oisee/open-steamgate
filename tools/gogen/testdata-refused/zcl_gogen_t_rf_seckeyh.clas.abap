* A hashed secondary key (abapiti 042): what stays refused. READ INTO a
* work area of another type (the row is not converted), DELETE inside a
* LOOP over the same table, and LOOP ... USING the key (its order is not
* measured).
CLASS zcl_gogen_t_rf_seckeyh DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF entry, k TYPE string, v TYPE i, END OF entry.
    TYPES: BEGIN OF short, k TYPE c LENGTH 4, END OF short.
    TYPES: BEGIN OF long, k TYPE c LENGTH 8, END OF long.
    TYPES shorts_type TYPE STANDARD TABLE OF short WITH DEFAULT KEY WITH UNIQUE HASHED KEY by_k COMPONENTS k.
    TYPES entries_type TYPE STANDARD TABLE OF entry WITH DEFAULT KEY WITH UNIQUE HASHED KEY by_k COMPONENTS k.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rf_seckeyh IMPLEMENTATION.
  METHOD run.
    DATA entries TYPE entries_type.
    DATA row TYPE entry.
    DATA shorts TYPE shorts_type.
    DATA wa TYPE long.
    READ TABLE shorts WITH KEY by_k COMPONENTS k = 'a' INTO wa.
    LOOP AT entries INTO row.
      DELETE TABLE entries WITH TABLE KEY by_k COMPONENTS k = row-k.
    ENDLOOP.
    LOOP AT entries INTO row USING KEY by_k.
      rv = rv && row-k.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
