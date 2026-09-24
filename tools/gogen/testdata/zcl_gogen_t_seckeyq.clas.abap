* LOOP ... USING KEY over a static attribute named with its class, and an
* APPEND to the same table through its plain name in the body. A4H
* 2026-09-24 ($ZOSG_TMP_0421, the critic's probe of ultra/json, this shape):
* the row appended during the loop is visited in its key place,
* "app:1/1,3/2,2/3, lines:3". The key order taken once before the first
* pass would print 1/1,2/2 (Go and JS did, silently): the
* front end refuses the loop instead (the qualifier is not a new table).
CLASS zcl_gogen_t_seckeyq DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             p TYPE string,
             n TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY
      WITH NON-UNIQUE SORTED KEY k_p COMPONENTS p.
    CLASS-DATA gt TYPE ty_tab.
ENDCLASS.

CLASS zcl_gogen_t_seckeyq IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE ty_row.
    DATA ls2 TYPE ty_row.
    DATA lv TYPE i.
    ls-p = 'a'. ls-n = 1. APPEND ls TO gt.
    ls-p = 'c'. ls-n = 2. APPEND ls TO gt.
    rv = 'app:'.
    LOOP AT zcl_gogen_t_seckeyq=>gt INTO ls USING KEY k_p.
      rv = |{ rv }{ ls-n }/{ sy-tabix },|.
      IF ls-n = 1.
        ls2-p = 'b'. ls2-n = 3. APPEND ls2 TO gt.
      ENDIF.
    ENDLOOP.
    lv = lines( gt ).
    rv = |{ rv } lines:{ lv }|.
  ENDMETHOD.
ENDCLASS.
