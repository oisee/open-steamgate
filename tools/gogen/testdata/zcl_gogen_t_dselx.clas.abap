* Dynamic Open SQL that is refused, not guessed: a view over a
* client-dependent table without MANDT, read by name, would see every
* client's rows (NOT_COMPILED, as the static read of ZCL_GOGEN_T_SELVIEWN).
CLASS zcl_gogen_t_dselx DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_dselx IMPLEMENTATION.
  METHOD run.
    DATA lv_name TYPE string.
    DATA lv_where TYPE string.
    DATA lr TYPE REF TO data.
    FIELD-SYMBOLS <lt> TYPE STANDARD TABLE.
    lv_name = `ZGOGEN_T_DBWN`.
    CREATE DATA lr TYPE STANDARD TABLE OF (lv_name).
    ASSIGN lr->* TO <lt>.
    SELECT * FROM (lv_name) INTO TABLE <lt> WHERE (lv_where).
    rv = |read:{ sy-dbcnt }|.
  ENDMETHOD.
ENDCLASS.
