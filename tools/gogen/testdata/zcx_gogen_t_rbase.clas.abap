CLASS zcx_gogen_t_rbase DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    DATA num TYPE i.
    METHODS constructor IMPORTING num TYPE i OPTIONAL previous LIKE previous OPTIONAL.
ENDCLASS.

CLASS zcx_gogen_t_rbase IMPLEMENTATION.
  METHOD constructor.
    super->constructor( previous = previous ).
    me->num = num.
  ENDMETHOD.
ENDCLASS.
