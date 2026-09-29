CLASS zcl_gogen_t_crdyn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_crdyn IMPLEMENTATION.
  METHOD run.
    DATA r TYPE REF TO data.
    DATA r2 TYPE REF TO data.
    DATA lv_name TYPE string.
    DATA lv_kind TYPE c LENGTH 1.
    FIELD-SYMBOLS <lt> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls> TYPE any.
    FIELD-SYMBOLS <lv> TYPE any.

    lv_name = 'T000'.
    CREATE DATA r TYPE STANDARD TABLE OF (lv_name).
    ASSIGN r->* TO <lt>.
    DESCRIBE FIELD <lt> TYPE lv_kind.
    rv = |a:{ lines( <lt> ) }/{ lv_kind }|.

    CREATE DATA r2 TYPE (lv_name).
    ASSIGN r2->* TO <ls>.
    DESCRIBE FIELD <ls> TYPE lv_kind.
    ASSIGN COMPONENT 'MANDT' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } b:{ lv_kind }/{ sy-subrc }[{ <lv> }]|.
    <lv> = '007'.
    APPEND <ls> TO <lt>.
    APPEND <ls> TO <lt>.
    rv = |{ rv } c:{ lines( <lt> ) }|.

    lv_name = 't000'.
    TRY.
        CREATE DATA r TYPE STANDARD TABLE OF (lv_name).
        rv = |{ rv } lower:ok|.
      CATCH cx_sy_create_data_error.
        rv = |{ rv } lower:err|.
    ENDTRY.
    lv_name = 'ZGOGEN_NO_SUCH_TAB'.
    TRY.
        CREATE DATA r TYPE STANDARD TABLE OF (lv_name).
        rv = |{ rv } unknown:ok|.
      CATCH cx_sy_create_data_error.
        rv = |{ rv } unknown:err|.
    ENDTRY.
    ASSIGN r->* TO <lt>.
    rv = |{ rv } kept:{ lines( <lt> ) }|.
  ENDMETHOD.
ENDCLASS.
