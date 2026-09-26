CLASS zcl_osd_classrun_out DEFINITION PUBLIC CREATE PUBLIC.
* The console IF_OO_ADT_CLASSRUN_OUT for OSD's classrun route
* (tools/adt-facade.mjs "oo/classrun", docs/adt-facade.md). The interface
* itself is not ours: it is open-abap-core's own
* (src/classrun/if_oo_adt_classrun_out.intf.abap, an MIT library already
* pulled in by abap_transpile.json), so this class only implements it.
*
* WRITE is kept modest: a simple value becomes one line, a structure
* becomes one "field: value, field: value" line, and an internal table
* becomes a header line of column names followed by one tab-separated
* line per row (its own line for an elementary-typed table). A ref, an
* object or anything else RTTI does not resolve to elem/struct/table
* becomes a line saying so rather than dumping.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun_out.

    "! Everything written so far, one line per WRITE, newline-joined.
    "! The interface's own GET answers the same text; this is here so a
    "! host that already holds the instance (tools/osd-classrun.mjs) need
    "! not go through the interface reference to read it back, including
    "! after a WRITE inside a step that later rolled back the database --
    "! the buffer is this object's own memory, not a row.
    METHODS text
      RETURNING VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    DATA gt_lines TYPE string_table.

    METHODS format_row
      IMPORTING iv_data       TYPE any
      RETURNING VALUE(rv_text) TYPE string.

    METHODS format_table
      IMPORTING iv_data        TYPE any
      RETURNING VALUE(rt_lines) TYPE string_table.
ENDCLASS.

CLASS zcl_osd_classrun_out IMPLEMENTATION.

  METHOD if_oo_adt_classrun_out~write.
    DATA lo_type TYPE REF TO cl_abap_typedescr.
    DATA lv_value TYPE string.

    lo_type = cl_abap_typedescr=>describe_by_data( data ).
    CASE lo_type->kind.
      WHEN cl_abap_typedescr=>kind_table.
        APPEND LINES OF format_table( data ) TO gt_lines.
      WHEN cl_abap_typedescr=>kind_struct.
        APPEND format_row( data ) TO gt_lines.
      WHEN cl_abap_typedescr=>kind_elem.
        lv_value = data.
        IF name IS SUPPLIED AND name IS NOT INITIAL.
          APPEND |{ name } = { lv_value }| TO gt_lines.
        ELSE.
          APPEND lv_value TO gt_lines.
        ENDIF.
      WHEN OTHERS.
        APPEND |(classrun: WRITE does not format a value of kind '{ lo_type->kind }')| TO gt_lines.
    ENDCASE.
    output = me.
  ENDMETHOD.

  METHOD if_oo_adt_classrun_out~get.
    output = text( ).
  ENDMETHOD.

  METHOD text.
    rv_text = concat_lines_of( table = gt_lines sep = cl_abap_char_utilities=>newline ).
  ENDMETHOD.

  METHOD format_row.
    DATA lo_struct TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    DATA ls_component TYPE abap_componentdescr.
    DATA lv_value TYPE string.
    FIELD-SYMBOLS <lv_field> TYPE any.

    lo_struct ?= cl_abap_typedescr=>describe_by_data( iv_data ).
    lt_components = lo_struct->get_components( ).
    LOOP AT lt_components INTO ls_component.
      ASSIGN COMPONENT ls_component-name OF STRUCTURE iv_data TO <lv_field>.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      lv_value = <lv_field>.
      IF rv_text IS INITIAL.
        rv_text = |{ ls_component-name }: { lv_value }|.
      ELSE.
        rv_text = |{ rv_text }, { ls_component-name }: { lv_value }|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD format_table.
    DATA lo_table TYPE REF TO cl_abap_tabledescr.
    DATA lo_line TYPE REF TO cl_abap_typedescr.
    DATA lo_struct TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    DATA ls_component TYPE abap_componentdescr.
    DATA lv_header TYPE string.
    DATA lv_row TYPE string.
    DATA lv_value TYPE string.
    FIELD-SYMBOLS <lt_table> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row> TYPE any.
    FIELD-SYMBOLS <lv_field> TYPE any.

    ASSIGN iv_data TO <lt_table>.
    lo_table ?= cl_abap_typedescr=>describe_by_data( iv_data ).
    lo_line = lo_table->get_table_line_type( ).

    IF lines( <lt_table> ) = 0.
      APPEND '(0 rows)' TO rt_lines.
      RETURN.
    ENDIF.

    IF lo_line->kind = cl_abap_typedescr=>kind_struct.
      lo_struct ?= lo_line.
      lt_components = lo_struct->get_components( ).
      LOOP AT lt_components INTO ls_component.
        IF lv_header IS INITIAL.
          lv_header = ls_component-name.
        ELSE.
          lv_header = |{ lv_header }\t{ ls_component-name }|.
        ENDIF.
      ENDLOOP.
      APPEND lv_header TO rt_lines.

      LOOP AT <lt_table> ASSIGNING <ls_row>.
        CLEAR lv_row.
        LOOP AT lt_components INTO ls_component.
          ASSIGN COMPONENT ls_component-name OF STRUCTURE <ls_row> TO <lv_field>.
          IF sy-subrc <> 0.
            CONTINUE.
          ENDIF.
          lv_value = <lv_field>.
          IF lv_row IS INITIAL.
            lv_row = lv_value.
          ELSE.
            lv_row = |{ lv_row }\t{ lv_value }|.
          ENDIF.
        ENDLOOP.
        APPEND lv_row TO rt_lines.
      ENDLOOP.
    ELSE.
      LOOP AT <lt_table> ASSIGNING <ls_row>.
        lv_value = <ls_row>.
        APPEND lv_value TO rt_lines.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
