* A ranges row with an OPTION in lower case is a dump on A4H
* (SAPSQL_IN_ITAB_ILLEGAL_OPTION, measured by foreman-dell, a4h-ranges.json)
* that CATCH cx_root does not take: never "no restriction".
CLASS zcl_gogen_t_seldump DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_seldump IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_range,
             sign   TYPE c LENGTH 1,
             option TYPE c LENGTH 2,
             low    TYPE c LENGTH 10,
             high   TYPE c LENGTH 10,
           END OF ty_range.
    DATA lt_id TYPE STANDARD TABLE OF zgogen_t_dbw-id WITH DEFAULT KEY.
    DATA lr TYPE STANDARD TABLE OF ty_range WITH DEFAULT KEY.
    DATA ls_r TYPE ty_range.
    ls_r-sign = 'I'. ls_r-option = 'cp'. ls_r-low = 'A*'. APPEND ls_r TO lr.
    TRY.
        SELECT id FROM zgogen_t_dbw INTO TABLE lt_id WHERE id IN lr.
        rv = `selected`.
      CATCH cx_root.
        rv = `caught`.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
