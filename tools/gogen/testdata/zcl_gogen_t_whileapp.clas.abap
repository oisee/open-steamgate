* A WHILE whose condition reads the string its body appends to
* (ultra/events: ZCL_OSD_TRAN_SESSION=>NEW_ID never ended in Go, whose
* loops append to a strings.Builder and wrote the string back only after).
CLASS zcl_gogen_t_whileapp DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             v TYPE string,
           END OF ty_row.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_whileapp IMPLEMENTATION.
  METHOD run.
    DATA lv TYPE string.
    DATA lt TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA ls TYPE ty_row.
    WHILE strlen( lv ) < 5.
      lv = lv && `ab`.
    ENDWHILE.
    rv = lv.
    ls-v = `x`. APPEND ls TO lt.
    ls-v = ``. APPEND ls TO lt.
    ls-v = `x`. APPEND ls TO lt.
    CLEAR lv.
* WHERE sees lv as the body left it: all three rows (xx if it did not)
    LOOP AT lt INTO ls WHERE v <> lv.
      lv = lv && `x`.
    ENDLOOP.
    rv = |{ rv } { lv }|.
  ENDMETHOD.
ENDCLASS.
