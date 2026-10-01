CLASS zcl_osd_lift_r3_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS before RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS after RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_lift_r3_probe IMPLEMENTATION.
  METHOD before.
    DATA ls_row TYPE zosd_lift_r2.
    SELECT * FROM zosd_lift_r2 INTO ls_row WHERE kind = 'STAT' ORDER BY PRIMARY KEY.
      CHECK ls_row-active = 'X'.
      CONCATENATE rv_text ls_row-seq INTO rv_text.
    ENDSELECT.
  ENDMETHOD.

  METHOD after.
    DATA ls_row TYPE zosd_lift_r2.
    " osd:gen r3-filter-into-where from=before begin
    SELECT * FROM zosd_lift_r2 INTO ls_row WHERE kind = 'STAT' AND active = 'X' ORDER BY PRIMARY KEY.
      CONCATENATE rv_text ls_row-seq INTO rv_text.
    ENDSELECT.
    " osd:gen r3-filter-into-where end
  ENDMETHOD.
ENDCLASS.
