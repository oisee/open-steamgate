* MODIFY itab FROM wa INDEX n and MODIFY itab INDEX n FROM wa: the order of
* the additions is free. Measured on A4H 2026-09-24 ($ZOSG_TMP_0195): sy-subrc
* 0 and sy-tabix n for a row that exists, 4 past the end.
CLASS zcl_gogen_t_modfrom DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_modfrom IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_row,
             id  TYPE c LENGTH 4,
             val TYPE i,
           END OF ty_row.
    DATA lt TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA ls TYPE ty_row.
    ls-id = 'A'. ls-val = 1. APPEND ls TO lt.
    ls-id = 'B'. ls-val = 2. APPEND ls TO lt.
    ls-id = 'C'. ls-val = 3. APPEND ls TO lt.
    READ TABLE lt INTO ls WITH KEY id = 'B'.
    ls-val = 20.
    MODIFY lt FROM ls INDEX sy-tabix.
    rv = |a:{ sy-subrc }/{ sy-tabix }|.
    ls-id = 'X'. ls-val = 30.
    MODIFY lt INDEX 3 FROM ls.
    rv = rv && | b:{ sy-subrc }/{ sy-tabix }|.
    MODIFY lt FROM ls INDEX 9.
    rv = rv && | c:{ sy-subrc }|.
    LOOP AT lt INTO ls.
      rv = rv && | { ls-id }{ ls-val }|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
