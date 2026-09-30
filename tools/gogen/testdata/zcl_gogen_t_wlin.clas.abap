CLASS zcl_gogen_t_wlin DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_wlin IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE string_table.
    APPEND `` TO lt.
    APPEND `a` TO lt.
    APPEND `` TO lt.
    APPEND `b` TO lt.
    DELETE lt WHERE table_line IS INITIAL.
    rv = |{ sy-subrc }/{ lines( lt ) }|.
    DELETE lt WHERE table_line = `a`.
    rv = rv && |/{ sy-subrc }/{ lines( lt ) }|.
    DELETE lt WHERE table_line IS NOT INITIAL.
    rv = rv && |/{ sy-subrc }/{ lines( lt ) }|.
    DELETE lt WHERE table_line IS INITIAL.
    rv = rv && |/{ sy-subrc }/{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
