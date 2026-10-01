* FIND ... IN [SECTION OFFSET o OF] xs IN BYTE MODE [MATCH OFFSET m]: the
* sXML reader crosses a UTF-8 document with it
CLASS zcl_gogen_t_findbyte DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_findbyte IMPLEMENTATION.
  METHOD run.
    DATA lv_xs TYPE xstring.
    DATA lv_lt TYPE x LENGTH 1 VALUE '3C'.
    DATA lv_pair TYPE xstring.
    DATA lv_none TYPE x LENGTH 1 VALUE '99'.
    DATA lv_off TYPE i.
    lv_xs = 'FF3C00413C42'.
    lv_pair = '0041'.
    FIND lv_lt IN lv_xs IN BYTE MODE MATCH OFFSET lv_off.
    rv = |a:{ sy-subrc }/{ lv_off }|.
    FIND lv_lt IN SECTION OFFSET 2 OF lv_xs IN BYTE MODE MATCH OFFSET lv_off.
    rv = |{ rv } b:{ sy-subrc }/{ lv_off }|.
    FIND FIRST OCCURRENCE OF lv_pair IN lv_xs IN BYTE MODE MATCH OFFSET lv_off.
    rv = |{ rv } c:{ sy-subrc }/{ lv_off }|.
    lv_off = 7.
    FIND lv_none IN lv_xs IN BYTE MODE MATCH OFFSET lv_off.
    rv = |{ rv } d:{ sy-subrc }/{ lv_off }|.
    FIND lv_lt IN SECTION OFFSET 6 OF lv_xs IN BYTE MODE MATCH OFFSET lv_off.
    rv = |{ rv } e:{ sy-subrc }/{ lv_off }|.
    FIND lv_lt IN SECTION OFFSET 5 OF lv_xs IN BYTE MODE.
    rv = |{ rv } f:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
