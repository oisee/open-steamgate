* A string moved into an n through generic data: digits that fit are
* zero-padded on the left (the NUMC rule A4H showed for a WHERE literal,
* docs/osql-where.md); anything else is a conversion rule not measured and
* is refused. The SADL DPC's synthetic keys of an aggregated row do this.
CLASS zcl_gogen_t_moven DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_moven IMPLEMENTATION.
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
    lv_s = `12345`.
    <lv> = lv_s.
    rv = |{ rv }/{ ls-k }|.
  ENDMETHOD.
ENDCLASS.
