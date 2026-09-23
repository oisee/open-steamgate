* An internal table named like a database table: DELETE <name> FROM n is
* the internal table's, as on A4H 2026-09-23, where the same method over a
* local table named T000 answered "lines:1  subrc:0" (i -> string, hence the
* blank). Here the name is the one TABL of testdata, so the dictionary alone
* would send the statement to the database.
CLASS zcl_gogen_t_delname DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_delname IMPLEMENTATION.
  METHOD run.
    DATA zgogen_t_dbw TYPE STANDARD TABLE OF zgogen_t_dbw WITH DEFAULT KEY.
    DATA ls TYPE zgogen_t_dbw.
    DATA lv TYPE string.
    ls-id = 'A'. APPEND ls TO zgogen_t_dbw.
    ls-id = 'B'. APPEND ls TO zgogen_t_dbw.
    ls-id = 'C'. APPEND ls TO zgogen_t_dbw.
    DELETE zgogen_t_dbw FROM 2.
    lv = lines( zgogen_t_dbw ).
    rv = |lines:{ lv } subrc:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
