CLASS zcl_gogen_t_drefloop DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             n TYPE i,
             s TYPE string,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_drefloop IMPLEMENTATION.
  METHOD run.
* LOOP AT ref->* ASSIGNING <typed> (CL_SXML_STRING_READER's reader): the
* rows of the table the reference points to, written through the field symbol
    DATA lr TYPE REF TO ty_tab.
    DATA ls TYPE ty_row.
    FIELD-SYMBOLS <ls> TYPE ty_row.
    FIELD-SYMBOLS <g> TYPE ANY TABLE.
    CREATE DATA lr.
    ASSIGN lr->* TO <g>.
    ls-n = 1. ls-s = 'a'. INSERT ls INTO TABLE <g>.
    ls-n = 2. ls-s = 'b'. INSERT ls INTO TABLE <g>.
    LOOP AT lr->* ASSIGNING <ls>.
      rv = |{ rv }{ sy-tabix }:{ <ls>-n }/{ <ls>-s },|.
      <ls>-n = <ls>-n * 10.
    ENDLOOP.
    LOOP AT lr->* ASSIGNING <ls>.
      rv = |{ rv }{ <ls>-n },|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
