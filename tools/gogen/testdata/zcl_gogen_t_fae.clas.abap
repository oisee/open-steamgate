* SELECT ... FOR ALL ENTRIES IN itab (parity-wave1: the demo DPC's
* $expand): duplicates of the driving table, the rows made unique over the
* columns selected, an empty driving table (the WHERE ignored, the other
* condition too), two fields of the driving row, INTO CORRESPONDING FIELDS.
* Run on A4H as written, on a throwaway table of the shape of
* zgogen_t_dbw.tabl.xml.
CLASS zcl_gogen_t_fae DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_k,
             id  TYPE c LENGTH 10,
             val TYPE i,
           END OF ty_k.
    TYPES: BEGIN OF ty_v,
             val TYPE i,
             xx  TYPE string,
           END OF ty_v.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_fae IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE zgogen_t_dbw.
    DATA lt TYPE STANDARD TABLE OF zgogen_t_dbw WITH DEFAULT KEY.
    DATA lt_k TYPE STANDARD TABLE OF ty_k WITH DEFAULT KEY.
    DATA ls_k TYPE ty_k.
    DATA lt_v TYPE STANDARD TABLE OF ty_v WITH DEFAULT KEY.
    DATA ls_v TYPE ty_v.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_i TYPE i.
    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1. INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 2. INSERT zgogen_t_dbw FROM ls.
    ls-id = 'C'. ls-val = 2. INSERT zgogen_t_dbw FROM ls.
    ls-id = 'D'. ls-val = 3. INSERT zgogen_t_dbw FROM ls.

    ls_k-id = 'A'. APPEND ls_k TO lt_k.
    ls_k-id = 'A'. APPEND ls_k TO lt_k.
    ls_k-id = 'C'. APPEND ls_k TO lt_k.
    ls_k-id = 'Z'. APPEND ls_k TO lt_k.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id.
    rv = |dup:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt ) }|.
    SORT lt BY id.
    LOOP AT lt INTO ls.
      rv = |{ rv },{ ls-id }{ ls-val }|.
    ENDLOOP.

    CLEAR lt_k.
    ls_k-id = 'A'. APPEND ls_k TO lt_k.
    ls_k-id = 'B'. APPEND ls_k TO lt_k.
    ls_k-id = 'C'. APPEND ls_k TO lt_k.
    SELECT val FROM zgogen_t_dbw INTO TABLE lt_i FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id.
    SORT lt_i.
    rv = |{ rv } col:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt_i ) }|.
    LOOP AT lt_i INTO lv_i.
      rv = |{ rv },{ lv_i }|.
    ENDLOOP.

    CLEAR lt_k.
    ls_k-id = 'B'. ls_k-val = 2. APPEND ls_k TO lt_k.
    ls_k-id = 'C'. ls_k-val = 3. APPEND ls_k TO lt_k.
    ls_k-id = 'D'. ls_k-val = 3. APPEND ls_k TO lt_k.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id AND val = lt_k-val.
    SORT lt BY id.
    rv = |{ rv } two:{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt INTO ls.
      rv = |{ rv },{ ls-id }{ ls-val }|.
    ENDLOOP.

    CLEAR lt_k.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id AND val = 2.
    rv = |{ rv } empty:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt ) }|.

    ls_k-id = 'B'. APPEND ls_k TO lt_k.
    ls_k-id = 'D'. APPEND ls_k TO lt_k.
    ls_v-xx = `keep`. APPEND ls_v TO lt_v.
    SELECT * FROM zgogen_t_dbw INTO CORRESPONDING FIELDS OF TABLE lt_v FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id.
    SORT lt_v BY val.
    rv = |{ rv } cor:{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt_v INTO ls_v.
      rv = |{ rv },{ ls_v-val }[{ ls_v-xx }]|.
    ENDLOOP.

    CLEAR lt_k.
    ls_k-id = 'Q'. APPEND ls_k TO lt_k.
    lt_i = VALUE #( ( 7 ) ).
    SELECT val FROM zgogen_t_dbw INTO TABLE lt_i FOR ALL ENTRIES IN lt_k WHERE id = lt_k-id.
    rv = |{ rv } none:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt_i ) }|.
  ENDMETHOD.
ENDCLASS.
