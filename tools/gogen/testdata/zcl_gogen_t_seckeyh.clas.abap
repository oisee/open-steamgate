CLASS zcl_gogen_t_seckeyh DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF entry, k TYPE string, v TYPE i, END OF entry.
    TYPES entries_type TYPE STANDARD TABLE OF entry WITH DEFAULT KEY WITH UNIQUE HASHED KEY by_k COMPONENTS k.
    CLASS-METHODS run RETURNING VALUE(result) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_seckeyh IMPLEMENTATION.
  METHOD run.
    " a unique hashed secondary key over a standard table (abapiti's maps):
    " read and deleted by value, the rows kept in the order they came
    DATA entries TYPE entries_type.
    DATA row TYPE entry.
    " named as the emitters' temporaries were before the critic round
    DATA v0 TYPE string VALUE `b`.
    DATA i TYPE entries_type.
    APPEND VALUE #( k = `b` v = 2 ) TO entries.
    APPEND VALUE #( k = `a` v = 1 ) TO entries.
    APPEND VALUE #( k = `c` v = 3 ) TO entries.
    READ TABLE entries WITH KEY by_k COMPONENTS k = `a` ASSIGNING FIELD-SYMBOL(<row>).
    IF sy-subrc = 0.
      <row>-v = 10.
    ENDIF.
    result = |r:{ sy-subrc }|.
    READ TABLE entries WITH KEY by_k COMPONENTS k = `c` INTO row.
    result = |{ result } i:{ sy-subrc }/{ row-v }|.
    row-v = 99.
    READ TABLE entries WITH KEY by_k COMPONENTS k = `x` INTO row.
    result = |{ result } miss:{ sy-subrc }/{ row-v }|.
    READ TABLE entries WITH KEY by_k COMPONENTS k = `b` TRANSPORTING NO FIELDS.
    result = |{ result } t:{ sy-subrc }|.
    DELETE TABLE entries WITH TABLE KEY by_k COMPONENTS k = v0.
    result = |{ result } d:{ sy-subrc }|.
    i = entries.
    DELETE TABLE i WITH TABLE KEY by_k COMPONENTS k = `a`.
    READ TABLE i WITH KEY by_k COMPONENTS k = `c` TRANSPORTING NO FIELDS.
    result = |{ result } i:{ lines( i ) }/{ sy-subrc }|.
    DELETE TABLE entries WITH TABLE KEY by_k COMPONENTS k = `b`.
    result = |{ result } d2:{ sy-subrc } |.
    LOOP AT entries INTO row.
      result = result && row-k && |{ row-v }|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
