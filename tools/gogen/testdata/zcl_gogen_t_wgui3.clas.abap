* Split out of ZCL_GOGEN_T_WGUI1 (ultra/events fix round): APPEND ...
* ASSIGNING and LOOP ASSIGNING with a field symbol typed string, which the
* JS emitter does not hold (it refuses this class, not WGUI1).
CLASS zcl_gogen_t_wgui3 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_wgui3 IMPLEMENTATION.
  METHOD run.
    DATA lt_str TYPE string_table.
    DATA lv_str TYPE string.
    FIELD-SYMBOLS <lv_s> TYPE string.

    APPEND `p` TO lt_str.
    APPEND `q` TO lt_str ASSIGNING <lv_s>.
    rv = |ap:{ sy-tabix }|.
    <lv_s> = `r`.
    LOOP AT lt_str ASSIGNING <lv_s>.
      <lv_s> = <lv_s> && `!`.
    ENDLOOP.
    CONCATENATE LINES OF lt_str INTO lv_str SEPARATED BY `/`.
    rv = |{ rv } fs:[{ lv_str }]|.
  ENDMETHOD.
ENDCLASS.
