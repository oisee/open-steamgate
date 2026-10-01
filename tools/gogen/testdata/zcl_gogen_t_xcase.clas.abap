CLASS zcl_gogen_t_xcase DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_xcase IMPLEMENTATION.
  METHOD run.
    DATA lv_short TYPE x LENGTH 1 VALUE 'AB'.
    DATA lv_long TYPE x LENGTH 2 VALUE 'AB00'.
    DATA lv_dynamic TYPE xstring VALUE 'AB'.
    CASE lv_short.
      WHEN lv_long.
        rv = `pad`.
    ENDCASE.
    IF lv_dynamic < lv_long.
      rv = rv && `/prefix`.
    ENDIF.
    IF lv_dynamic <> lv_long.
      rv = rv && `/length`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
