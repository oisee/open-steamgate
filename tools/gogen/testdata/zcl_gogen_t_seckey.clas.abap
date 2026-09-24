CLASS zcl_gogen_t_seckey DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             p TYPE string,
             u TYPE string,
             n TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY
      WITH UNIQUE SORTED KEY k_u COMPONENTS u
      WITH NON-UNIQUE SORTED KEY k_p COMPONENTS p.
ENDCLASS.

CLASS zcl_gogen_t_seckey IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    FIELD-SYMBOLS <ls> TYPE ty_row.
* rows appended with duplicates of p
    ls-p = 'b'. ls-u = 'u5'. ls-n = 1. APPEND ls TO lt.
    ls-p = 'a'. ls-u = 'u4'. ls-n = 2. APPEND ls TO lt.
    ls-p = 'b'. ls-u = 'u3'. ls-n = 3. APPEND ls TO lt.
    ls-p = 'a'. ls-u = 'u2'. ls-n = 4. APPEND ls TO lt.
    ls-p = 'b'. ls-u = 'u1'. ls-n = 5. APPEND ls TO lt.
* the duplicates of one key value: their order and sy-tabix
    rv = 'w:'.
    LOOP AT lt INTO ls USING KEY k_p WHERE p = 'b'.
      rv = |{ rv }{ ls-n }/{ sy-tabix },|.
    ENDLOOP.
    rv = |{ rv } after:{ sy-tabix }|.
* a row inserted before the others in the primary index
    ls-p = 'b'. ls-u = 'u0'. ls-n = 0. INSERT ls INTO lt INDEX 1.
    rv = |{ rv } ins:|.
    LOOP AT lt INTO ls USING KEY k_p WHERE p = 'b'.
      rv = |{ rv }{ ls-n }/{ sy-tabix },|.
    ENDLOOP.
* a key field changed through a field symbol
    LOOP AT lt ASSIGNING <ls> WHERE n = 3.
      <ls>-p = 'a'.
    ENDLOOP.
    rv = |{ rv } mod:|.
    LOOP AT lt INTO ls USING KEY k_p WHERE p = 'a'.
      rv = |{ rv }{ ls-n }/{ sy-tabix },|.
    ENDLOOP.
* READ with the unique key and with the non-unique one
    READ TABLE lt INTO ls WITH KEY k_u COMPONENTS u = 'u3'.
    rv = |{ rv } ru:{ sy-subrc }/{ ls-n }/{ sy-tabix }|.
    READ TABLE lt INTO ls WITH KEY k_p COMPONENTS p = 'b'.
    rv = |{ rv } rp:{ sy-subrc }/{ ls-n }/{ sy-tabix }|.
    READ TABLE lt INTO ls WITH KEY k_u COMPONENTS u = 'zz'.
    rv = |{ rv } rmiss:{ sy-subrc }/{ ls-n }/{ sy-tabix }|.
  ENDMETHOD.
ENDCLASS.
