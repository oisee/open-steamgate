* sy-subrc after a static method call with no EXCEPTIONS, following a READ
* TABLE that missed (sy-subrc 4). A4H answered "call:0" (probe
* ZCL_GOGEN_T_CNT in $ZOSG_TMP_0220, 2026-09-23, deleted; the probe's
* source was not kept, this class is its call line written again). The
* gogen subset emits a call without touching sy-subrc and answers
* "call:4": pinned so, a known gap of call emission (README).
CLASS zcl_gogen_t_callsubrc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS noop.
ENDCLASS.

CLASS zcl_gogen_t_callsubrc IMPLEMENTATION.
  METHOD noop.
  ENDMETHOD.

  METHOD run.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv TYPE i.
    READ TABLE lt INDEX 1 INTO lv.
    rv = |read:{ sy-subrc }|.
    noop( ).
    rv = rv && | call:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
