CLASS zcl_gogen_t_crelem DEFINITION PUBLIC FINAL CREATE PUBLIC.
* CREATE DATA ref LIKE LINE OF a generic table whose rows are elementary
* (/UI2/CL_JSON deserializing into a table of strings): a new initial
* value of the row type, its kind, written and inserted
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_c3 TYPE c LENGTH 3.
    TYPES ty_n4 TYPE n LENGTH 4.
    CLASS-METHODS one
      IMPORTING iv_value  TYPE string
      CHANGING  ct_table  TYPE ANY TABLE
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_crelem IMPLEMENTATION.
  METHOD one.
    DATA lr_row TYPE REF TO data.
    DATA lv_kind TYPE c LENGTH 1.
    DATA lv_init TYPE string.
    DATA lv_after TYPE string.
    FIELD-SYMBOLS <lv_row> TYPE any.
    CREATE DATA lr_row LIKE LINE OF ct_table.
    ASSIGN lr_row->* TO <lv_row>.
    DESCRIBE FIELD <lv_row> TYPE lv_kind.
    lv_init = <lv_row>.
    <lv_row> = iv_value.
    lv_after = <lv_row>.
    INSERT <lv_row> INTO TABLE ct_table.
    rv = |{ lv_kind }[{ lv_init }][{ lv_after }]{ lines( ct_table ) }|.
  ENDMETHOD.

  METHOD run.
    DATA lt_s TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lt_c TYPE STANDARD TABLE OF ty_c3 WITH DEFAULT KEY.
    DATA lt_d TYPE STANDARD TABLE OF d WITH DEFAULT KEY.
    DATA lt_t TYPE STANDARD TABLE OF t WITH DEFAULT KEY.
    DATA lt_n TYPE STANDARD TABLE OF ty_n4 WITH DEFAULT KEY.
    rv = |s:{ one( EXPORTING iv_value = `ab` CHANGING ct_table = lt_s ) }|.
    rv = |{ rv } s2:{ one( EXPORTING iv_value = `cd` CHANGING ct_table = lt_s ) }|.
    rv = |{ rv } i:{ one( EXPORTING iv_value = `42` CHANGING ct_table = lt_i ) }|.
    rv = |{ rv } c:{ one( EXPORTING iv_value = `abcd` CHANGING ct_table = lt_c ) }|.
    rv = |{ rv } d:{ one( EXPORTING iv_value = `20250107` CHANGING ct_table = lt_d ) }|.
    rv = |{ rv } t:{ one( EXPORTING iv_value = `123456` CHANGING ct_table = lt_t ) }|.
    rv = |{ rv } n:{ one( EXPORTING iv_value = `12` CHANGING ct_table = lt_n ) }|.
  ENDMETHOD.
ENDCLASS.
