CLASS zcl_gogen_t_base DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mv_log TYPE string.
    METHODS constructor IMPORTING iv_tag TYPE string.
    METHODS describe RETURNING VALUE(rv) TYPE string.
    METHODS name RETURNING VALUE(rv) TYPE string.
    METHODS kind ABSTRACT RETURNING VALUE(rv) TYPE string.
  PROTECTED SECTION.
    DATA mv_tag TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_base IMPLEMENTATION.
  METHOD constructor.
    mv_tag = iv_tag.
    mv_log = |ctor:{ name( ) }|.
  ENDMETHOD.
  METHOD describe.
    rv = |{ name( ) }/{ kind( ) }/{ mv_tag }|.
  ENDMETHOD.
  METHOD name.
    rv = `base`.
  ENDMETHOD.
ENDCLASS.
