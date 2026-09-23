* COMMIT WORK / ROLLBACK WORK set sy-subrc 0 (A4H 2026-09-23). A4H ran it
* with sy-subrc = 7 before each, rows of a table in between, and read
* sy-dbcnt too (unchanged, 7). The subset does not assign sy fields, writes
* no rows (database writes do not compile yet) and has no sy-dbcnt, so the
* local copy sets sy-subrc 4 with a READ that misses and reads sy-subrc only.
CLASS zcl_gogen_t_luw DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_luw IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv TYPE i.
    READ TABLE lt INDEX 1 INTO lv.
    rv = |miss:{ sy-subrc }|.
    READ TABLE lt INDEX 1 INTO lv.
    ROLLBACK WORK.
    rv = rv && | rb:{ sy-subrc }|.
    READ TABLE lt INDEX 1 INTO lv.
    COMMIT WORK.
    rv = rv && | cw:{ sy-subrc }|.
    READ TABLE lt INDEX 1 INTO lv.
    COMMIT WORK AND WAIT.
    rv = rv && | cww:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
