* A string with a letter moved into an n through generic data: a
* conversion rule not measured, refused (ZCL_GOGEN_T_MOVEN is the shape
* that is carried).
CLASS zcl_gogen_t_movenx DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_movenx IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_k,
             k TYPE n LENGTH 6,
           END OF ty_k.
    DATA ls TYPE ty_k.
    DATA lv_s TYPE string.
    FIELD-SYMBOLS <lv> TYPE any.
    ASSIGN COMPONENT 'K' OF STRUCTURE ls TO <lv>.
    lv_s = `4711`.
    <lv> = lv_s.
    rv = |{ ls-k }|.
    lv_s = `47a`.
    <lv> = lv_s.
    rv = |{ rv }/{ ls-k }|.
  ENDMETHOD.
ENDCLASS.
