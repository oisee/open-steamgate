* Dynamic Open SQL (go/abap selectdyn.go): the table static or by name, a
* CDS name read through its SQL view, WHERE (x) parsed by the port of
* tools/ir-osql-where.mjs, GROUP BY / ORDER BY (x), an empty condition, and
* what A4H raised for '1 = 1' (_SEMANTICS) and for an operator without
* blanks (_SYNTAX), both caught. The rows are ordinary Open SQL, not an A4H
* measurement; the two exceptions are A4H's (docs/osql-where.md, #47).
CLASS zcl_gogen_t_dsel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_sum,
             id  TYPE c LENGTH 10,
             val TYPE i,
           END OF ty_sum.
    TYPES: BEGIN OF ty_amt,
             id     TYPE c LENGTH 10,
             amount TYPE i,
           END OF ty_amt.
    CLASS-METHODS ids IMPORTING it TYPE ANY TABLE RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_dsel IMPLEMENTATION.
  METHOD ids.
    FIELD-SYMBOLS <ls> TYPE any.
    FIELD-SYMBOLS <lv> TYPE any.
    LOOP AT it ASSIGNING <ls>.
      ASSIGN COMPONENT 'ID' OF STRUCTURE <ls> TO <lv>.
      rv = |{ rv }{ <lv> }|.
    ENDLOOP.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE zgogen_t_dbw.
    DATA lt TYPE STANDARD TABLE OF zgogen_t_dbw WITH DEFAULT KEY.
    DATA lt_sum TYPE STANDARD TABLE OF ty_sum WITH DEFAULT KEY.
    DATA ls_sum TYPE ty_sum.
    DATA lt_amt TYPE STANDARD TABLE OF ty_amt WITH DEFAULT KEY.
    DATA ls_amt TYPE ty_amt.
    DATA lv_where TYPE string.
    DATA lv_name TYPE string.
    DATA lt_order TYPE string_table.
    DATA lt_fields TYPE string_table.
    DATA lt_group TYPE string_table.
    DATA lr TYPE REF TO data.
    DATA lx TYPE REF TO cx_root.
    FIELD-SYMBOLS <lt> TYPE STANDARD TABLE.

    DELETE FROM zgogen_t_dbw.
    ls-id = 'A'. ls-val = 1.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'B'. ls-val = 2.
    INSERT zgogen_t_dbw FROM ls.
    ls-id = 'C'. ls-val = 3.
    INSERT zgogen_t_dbw FROM ls.

*   a static table, the condition and the order at run time
    lv_where = `val > 1`.
    APPEND `ID DESCENDING` TO lt_order.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt WHERE (lv_where) ORDER BY (lt_order).
    rv = |static:{ sy-subrc }/{ sy-dbcnt }/{ ids( lt ) }|.

*   the table by name, in lower case, into a table made by name
    lv_name = `zgogen_t_dbw`.
    CREATE DATA lr TYPE STANDARD TABLE OF (lv_name).
    ASSIGN lr->* TO <lt>.
    lv_where = `id <> 'B'`.
    SELECT * FROM (lv_name) INTO CORRESPONDING FIELDS OF TABLE <lt> WHERE (lv_where) ORDER BY PRIMARY KEY.
    rv = |{ rv } byname:{ sy-subrc }/{ sy-dbcnt }/{ ids( <lt> ) }|.

*   a CDS name, read through its SQL view (where MANDT is)
    lv_name = `ZGOGEN_T_DBWC`.
    lv_where = `amount >= '2'`.
    CLEAR lt_order.
    APPEND `amount ASCENDING` TO lt_order.
    SELECT * FROM (lv_name) INTO CORRESPONDING FIELDS OF TABLE lt_amt WHERE (lv_where) ORDER BY (lt_order).
    rv = |{ rv } cds:{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt_amt INTO ls_amt.
      rv = |{ rv },{ ls_amt-id }{ ls_amt-amount }|.
    ENDLOOP.

*   an empty condition is every row
    CLEAR lv_where.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt WHERE (lv_where).
    rv = |{ rv } empty:{ sy-subrc }/{ sy-dbcnt }|.

*   no row: sy-subrc 4, the table emptied
    lv_where = `id = 'Z'`.
    SELECT * FROM zgogen_t_dbw INTO TABLE lt WHERE (lv_where).
    rv = |{ rv } none:{ sy-subrc }/{ sy-dbcnt }/{ lines( lt ) }|.

*   a field list with an aggregate, grouped
    APPEND `id` TO lt_fields.
    APPEND `SUM( val ) AS val` TO lt_fields.
    APPEND `id` TO lt_group.
    CLEAR lt_order.
    APPEND `id DESCENDING` TO lt_order.
    lv_where = `id IN ('A','C')`.
    SELECT (lt_fields) FROM zgogen_t_dbw INTO CORRESPONDING FIELDS OF TABLE lt_sum WHERE (lv_where) GROUP BY (lt_group) ORDER BY (lt_order).
    rv = |{ rv } sum:{ sy-subrc }/{ sy-dbcnt }|.
    LOOP AT lt_sum INTO ls_sum.
      rv = |{ rv },{ ls_sum-id }{ ls_sum-val }|.
    ENDLOOP.

*   '1 = 1': CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H
    lv_where = `1 = 1`.
    TRY.
        SELECT * FROM zgogen_t_dbw INTO TABLE lt WHERE (lv_where).
        rv = |{ rv } one:read|.
      CATCH cx_sy_dynamic_osql_semantics.
        rv = |{ rv } one:semantics|.
    ENDTRY.

*   an operator without blanks: CX_SY_DYNAMIC_OSQL_SYNTAX on A4H, caught
*   by the common superclass
    lv_where = `id='A'`.
    TRY.
        SELECT * FROM zgogen_t_dbw INTO TABLE lt WHERE (lv_where).
        rv = |{ rv } syntax:read|.
      CATCH cx_sy_dynamic_osql_error INTO lx.
        rv = |{ rv } syntax:caught|.
    ENDTRY.
    ROLLBACK WORK.
  ENDMETHOD.
ENDCLASS.
