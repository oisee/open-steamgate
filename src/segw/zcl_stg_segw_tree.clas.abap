CLASS zcl_stg_segw_tree DEFINITION PUBLIC CREATE PUBLIC.
* The project tree as SEGW sees it: a node and the rows below it. Deleting
* a node takes its subtree the way SEGW does: the rows whose PARENT_UUID
* (SBD_*, SBO_PR), ENTITY_GUID (SBO_NP), ASSOCIATION_GUID (SBO_RC, SBO_AT)
* or FUNCTION_IMPORT (SBO_FP) is the node, and their subtrees in turn,
* plus every row that shares the node's NODE_UUID (its text rows, the
* SBD_MR rules of a mapping property). ENTITY_TYPE of an entity set is a
* reference, not a parent: deleting an entity type leaves its sets.
  PUBLIC SECTION.
    CLASS-METHODS delete_subtree
      IMPORTING
        iv_project     TYPE string
        iv_node        TYPE string
      RETURNING
        VALUE(rv_rows) TYPE i
      RAISING
        /iwbep/cx_mgw_busi_exception.

  PRIVATE SECTION.
    CONSTANTS gc_class TYPE string VALUE 'ZCL_STG_TAB_ZSTG_'.

    TYPES: BEGIN OF ty_table,
             tag    TYPE string,
             source TYPE REF TO zif_stg_cds_source,
             refs   TYPE string_table,
             has_uuid TYPE abap_bool,
           END OF ty_table.
    TYPES tt_table TYPE STANDARD TABLE OF ty_table WITH DEFAULT KEY.

    CLASS-METHODS tables
      RETURNING
        VALUE(rt_tables) TYPE tt_table.

    CLASS-METHODS sql_literal
      IMPORTING
        iv_value         TYPE string
      RETURNING
        VALUE(rv_literal) TYPE string.
ENDCLASS.

CLASS zcl_stg_segw_tree IMPLEMENTATION.

  METHOD delete_subtree.
    DATA lt_tables  TYPE tt_table.
    DATA ls_table   TYPE ty_table.
    DATA lt_queue   TYPE string_table.
    DATA lt_done    TYPE string_table.
    DATA lv_node    TYPE string.
    DATA lv_ref     TYPE string.
    DATA lv_where   TYPE string.
    DATA lv_project TYPE string.
    DATA lt_orderby TYPE string_table.
    DATA lr_data    TYPE REF TO data.
    DATA lv_child   TYPE string.
    FIELD-SYMBOLS <lt_data>  TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>   TYPE any.
    FIELD-SYMBOLS <lv_value> TYPE any.

    lt_tables = tables( ).
    lv_project = sql_literal( iv_project ).
    APPEND iv_node TO lt_queue.
    WHILE lt_queue IS NOT INITIAL.
      READ TABLE lt_queue INDEX 1 INTO lv_node.
      DELETE lt_queue INDEX 1.
      READ TABLE lt_done WITH KEY table_line = lv_node TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        CONTINUE.
      ENDIF.
      APPEND lv_node TO lt_done.
      LOOP AT lt_tables INTO ls_table.
* the node's own rows and the rows that point at it, in one read
        CLEAR lv_where.
        IF ls_table-has_uuid = abap_true.
          lv_where = |NODE_UUID = { sql_literal( lv_node ) }|.
        ENDIF.
        LOOP AT ls_table-refs INTO lv_ref.
          IF lv_where IS NOT INITIAL.
            lv_where = lv_where && ` OR `.
          ENDIF.
          lv_where = lv_where && |{ lv_ref } = { sql_literal( lv_node ) }|.
        ENDLOOP.
        IF lv_where IS INITIAL.
          CONTINUE.
        ENDIF.
        lv_where = |PROJECT = { lv_project } AND ( { lv_where } )|.
        lr_data = ls_table-source->read( iv_where   = lv_where
                                         it_orderby = lt_orderby ).
        ASSIGN lr_data->* TO <lt_data>.
        LOOP AT <lt_data> ASSIGNING <ls_row>.
          IF ls_table-has_uuid = abap_true.
            ASSIGN COMPONENT 'NODE_UUID' OF STRUCTURE <ls_row> TO <lv_value>.
            lv_child = <lv_value>.
            IF lv_child <> lv_node.
              APPEND lv_child TO lt_queue.
            ENDIF.
          ENDIF.
          ls_table-source->delete( <ls_row> ).
          rv_rows = rv_rows + 1.
        ENDLOOP.
      ENDLOOP.
    ENDWHILE.
  ENDMETHOD.

  METHOD tables.
* every ZSTG_SB* table with the columns that point at a parent node
    DATA lt_entities   TYPE zcl_stg_cds_registry=>tt_entity.
    DATA ls_entity     TYPE zcl_stg_cds_registry=>ty_entity.
    DATA ls_table      TYPE ty_table.
    DATA lv_class      TYPE string.
    DATA lv_len        TYPE i.
    DATA lr_line       TYPE REF TO data.
    DATA lo_struct     TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    DATA ls_component  TYPE abap_componentdescr.
    FIELD-SYMBOLS <ls_line> TYPE any.

    lv_len = strlen( gc_class ).
    lt_entities = zcl_stg_cds_registry=>entities( ).
    LOOP AT lt_entities INTO ls_entity.
      IF strlen( ls_entity-source_class ) <= lv_len OR ls_entity-source_class(lv_len) <> gc_class.
        CONTINUE.
      ENDIF.
      CLEAR ls_table.
      ls_table-tag = ls_entity-source_class+lv_len.
      IF ls_table-tag(3) <> 'SBD' AND ls_table-tag(3) <> 'SBO'.
        CONTINUE.
      ENDIF.
      lv_class = ls_entity-source_class.
      CREATE OBJECT ls_table-source TYPE (lv_class).
      lr_line = ls_table-source->create_line( ).
      ASSIGN lr_line->* TO <ls_line>.
      lo_struct ?= cl_abap_typedescr=>describe_by_data( <ls_line> ).
      lt_components = lo_struct->get_components( ).
      LOOP AT lt_components INTO ls_component.
        CASE ls_component-name.
          WHEN 'NODE_UUID'.
            ls_table-has_uuid = abap_true.
          WHEN 'PARENT_UUID' OR 'ENTITY_GUID' OR 'ASSOCIATION_GUID' OR 'FUNCTION_IMPORT'.
            APPEND ls_component-name TO ls_table-refs.
        ENDCASE.
      ENDLOOP.
      APPEND ls_table TO rt_tables.
    ENDLOOP.
  ENDMETHOD.

  METHOD sql_literal.
    rv_literal = |'{ replace( val = iv_value sub = `'` with = `''` occ = 0 ) }'|.
  ENDMETHOD.

ENDCLASS.
