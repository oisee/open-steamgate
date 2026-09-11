CLASS zcl_stg_sadl_dpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_data CREATE PUBLIC.
* The generic data provider behind a reference-data-source service: reads
* the CDS entity a SADL structure is bound to through its generated source
* class, with the request's ranges, order, paging and navigation turned
* into Open SQL. Aggregate entities ($select on a cube) are grouped.
  PUBLIC SECTION.
    INTERFACES if_sadl_gw_dpc.

    METHODS constructor
      IMPORTING
        iv_sadl_xml TYPE string.
  PRIVATE SECTION.
    DATA mo_def TYPE REF TO zcl_stg_sadl_def.

    METHODS entity_of
      IMPORTING
        iv_entity_set    TYPE string
      RETURNING
        VALUE(rs_entity) TYPE zcl_stg_cds_registry=>ty_entity
      RAISING
        /iwbep/cx_mgw_tech_exception.

    METHODS source_of
      IMPORTING
        is_entity        TYPE zcl_stg_cds_registry=>ty_entity
      RETURNING
        VALUE(ro_source) TYPE REF TO zif_stg_cds_source.

    METHODS navigation_where
      IMPORTING
        io_context      TYPE REF TO zcl_stg_request_context
      RETURNING
        VALUE(rv_where) TYPE string.

    METHODS key_where
      IMPORTING
        it_key_tab      TYPE /iwbep/t_mgw_name_value_pair
      RETURNING
        VALUE(rv_where) TYPE string.

    METHODS orderby_of
      IMPORTING
        it_orderby        TYPE /iwbep/t_mgw_tech_order
      RETURNING
        VALUE(rt_orderby) TYPE string_table.

    METHODS aggregate_fields
      IMPORTING
        is_entity  TYPE zcl_stg_cds_registry=>ty_entity
        iv_select  TYPE string
      EXPORTING
        et_fields  TYPE string_table
        et_groupby TYPE string_table.

    METHODS sql_literal
      IMPORTING
        iv_value          TYPE string
      RETURNING
        VALUE(rv_literal) TYPE string.

    METHODS and_where
      IMPORTING
        iv_left         TYPE string
        iv_right        TYPE string
      RETURNING
        VALUE(rv_where) TYPE string.
ENDCLASS.

CLASS zcl_stg_sadl_dpc IMPLEMENTATION.

  METHOD constructor.
    super->constructor( ).
    CREATE OBJECT mo_def
      EXPORTING
        iv_sadl_xml = iv_sadl_xml.
  ENDMETHOD.

  METHOD entity_of.
    DATA ls_structure TYPE zcl_stg_sadl_def=>ty_structure.

    ls_structure = mo_def->structure_by_set( iv_entity_set ).
    IF ls_structure-name IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
        EXPORTING
          method = |SADL structure for entity set { iv_entity_set }|.
    ENDIF.
    rs_entity = zcl_stg_cds_registry=>get( mo_def->binding_of( ls_structure-data_source ) ).
    IF rs_entity-name IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
        EXPORTING
          method = |CDS entity { ls_structure-data_source }|.
    ENDIF.
  ENDMETHOD.

  METHOD source_of.
    DATA lv_class TYPE string.

    lv_class = is_entity-source_class.
    CREATE OBJECT ro_source TYPE (lv_class).
  ENDMETHOD.

  METHOD sql_literal.
    DATA lv_quote TYPE string.
    DATA lv_two   TYPE string.

    lv_quote   = |'|.
    lv_two     = |''|.
    rv_literal = iv_value.
    REPLACE ALL OCCURRENCES OF lv_quote IN rv_literal WITH lv_two.
    rv_literal = |'{ rv_literal }'|.
  ENDMETHOD.

  METHOD and_where.
    IF iv_left IS INITIAL.
      rv_where = iv_right.
    ELSEIF iv_right IS INITIAL.
      rv_where = iv_left.
    ELSE.
      rv_where = |( { iv_left } ) AND ( { iv_right } )|.
    ENDIF.
  ENDMETHOD.

  METHOD key_where.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.

    LOOP AT it_key_tab INTO ls_key.
      rv_where = and_where( iv_left  = rv_where
                            iv_right = |{ to_upper( ls_key-name ) } = { sql_literal( ls_key-value ) }| ).
    ENDLOOP.
  ENDMETHOD.

  METHOD navigation_where.
* Set(key)/nav: the source structure's association tells which target
* fields equal which source keys
    DATA ls_path      TYPE /iwbep/s_mgw_navigation_path.
    DATA ls_source    TYPE zcl_stg_sadl_def=>ty_structure.
    DATA ls_assoc     TYPE zcl_stg_sadl_def=>ty_association.
    DATA ls_entity    TYPE zcl_stg_cds_registry=>ty_entity.
    DATA ls_cds_assoc TYPE zcl_stg_cds_registry=>ty_assoc.
    DATA ls_pair      TYPE zcl_stg_cds_registry=>ty_pair.
    DATA ls_key       TYPE /iwbep/s_mgw_name_value_pair.
    DATA lv_source_set TYPE string.

    READ TABLE io_context->mt_navigation_path INTO ls_path INDEX 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_source_set = io_context->mv_source_entity_set.
    ls_source = mo_def->structure_by_set( lv_source_set ).
    IF ls_source-name IS INITIAL.
      RETURN.
    ENDIF.
    READ TABLE ls_source-associations INTO ls_assoc WITH KEY name = ls_path-nav_prop.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    ls_entity = zcl_stg_cds_registry=>get( mo_def->binding_of( ls_source-data_source ) ).
    LOOP AT ls_entity-associations INTO ls_cds_assoc.
      IF to_upper( ls_cds_assoc-name ) = to_upper( ls_assoc-binding ).
        EXIT.
      ENDIF.
      CLEAR ls_cds_assoc.
    ENDLOOP.
    LOOP AT ls_cds_assoc-pairs INTO ls_pair.
      LOOP AT ls_path-key_tab INTO ls_key.
        IF to_upper( ls_key-name ) = ls_pair-source.
          rv_where = and_where( iv_left  = rv_where
                                iv_right = |{ ls_pair-target } = { sql_literal( ls_key-value ) }| ).
        ENDIF.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD orderby_of.
    DATA ls_order TYPE /iwbep/s_mgw_tech_order.
    DATA lv_line  TYPE string.

    LOOP AT it_orderby INTO ls_order.
      IF to_lower( ls_order-order ) = 'desc'.
        lv_line = |{ to_upper( ls_order-property ) } DESCENDING|.
      ELSE.
        lv_line = |{ to_upper( ls_order-property ) } ASCENDING|.
      ENDIF.
      APPEND lv_line TO rt_orderby.
    ENDLOOP.
  ENDMETHOD.

  METHOD aggregate_fields.
* $select on an aggregate entity: dimensions group, measures sum
    DATA lt_selected TYPE string_table.
    DATA lv_name     TYPE string.
    DATA ls_field    TYPE zcl_stg_cds_registry=>ty_field.
    DATA lv_function TYPE string.
    DATA lv_line     TYPE string.

    CLEAR et_fields.
    CLEAR et_groupby.
    SPLIT iv_select AT ',' INTO TABLE lt_selected.
    LOOP AT lt_selected INTO lv_name.
      CONDENSE lv_name.
      READ TABLE is_entity-fields INTO ls_field WITH KEY name = lv_name.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      CLEAR lv_function.
      FIND REGEX '@Aggregation\.default:\s*#(\w+)' IN TABLE ls_field-annotations IGNORING CASE SUBMATCHES lv_function.
      lv_function = to_upper( lv_function ).
* column names lower case: the runtime maps result columns to the
* structure's components by exact name
      IF lv_function IS INITIAL OR lv_function = 'NONE'.
        lv_line = to_lower( ls_field-name ).
        APPEND lv_line TO et_fields.
        APPEND lv_line TO et_groupby.
      ELSE.
        lv_line = |{ lv_function }( { to_lower( ls_field-name ) } ) AS { to_lower( ls_field-name ) }|.
        APPEND lv_line TO et_fields.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~get_entityset.
    DATA lo_context  TYPE REF TO zcl_stg_request_context.
    DATA ls_entity   TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lo_source   TYPE REF TO zif_stg_cds_source.
    DATA lv_where    TYPE string.
    DATA lt_orderby  TYPE string_table.
    DATA lt_fields   TYPE string_table.
    DATA lt_groupby  TYPE string_table.
    DATA lr_data     TYPE REF TO data.
    DATA lv_skip     TYPE i.
    DATA lv_top      TYPE i.
    DATA lv_index    TYPE i.
    DATA lv_select   TYPE string.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.

    lo_context ?= io_tech_request_context.
    ls_entity = entity_of( io_tech_request_context->get_entity_set_name( ) ).
    lo_source = source_of( ls_entity ).

    lv_where = io_tech_request_context->get_osql_where_clause( ).
    lv_where = and_where( iv_left  = lv_where
                          iv_right = navigation_where( lo_context ) ).
    lt_orderby = orderby_of( io_tech_request_context->get_orderby( ) ).

    lv_select = lo_context->mv_select.
    IF lv_select IS NOT INITIAL AND lo_context->mv_aggregate = abap_true.
      aggregate_fields( EXPORTING is_entity  = ls_entity
                                  iv_select  = lv_select
                        IMPORTING et_fields  = lt_fields
                                  et_groupby = lt_groupby ).
    ENDIF.

    lr_data = lo_source->read( iv_where   = lv_where
                               it_orderby = lt_orderby
                               it_fields  = lt_fields
                               it_groupby = lt_groupby ).
    ASSIGN lr_data->* TO <lt_data>.

* paging after the read, the way SADL's own DPC does it without HANA
    lv_skip = io_tech_request_context->get_skip( ).
    lv_top  = io_tech_request_context->get_top( ).
    IF lo_context->mv_count = abap_false.
      IF lv_skip > 0.
        DO lv_skip TIMES.
          DELETE <lt_data> INDEX 1.
        ENDDO.
      ENDIF.
      IF lv_top > 0.
        lv_index = lv_top + 1.
        WHILE lines( <lt_data> ) >= lv_index.
          DELETE <lt_data> INDEX lv_index.
        ENDWHILE.
      ENDIF.
    ENDIF.

    et_data = <lt_data>.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~get_entity.
    DATA lo_context TYPE REF TO zcl_stg_request_context.
    DATA ls_entity  TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lo_source  TYPE REF TO zif_stg_cds_source.
    DATA lv_where   TYPE string.
    DATA lt_orderby TYPE string_table.
    DATA lr_data    TYPE REF TO data.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>  TYPE any.

    lo_context ?= io_tech_request_context.
    ls_entity = entity_of( io_tech_request_context->get_entity_set_name( ) ).
    lo_source = source_of( ls_entity ).

* through a navigation the association pairs identify the target; the key
* tab then still holds the source keys and must not be applied
    IF lo_context->mt_navigation_path IS NOT INITIAL.
      lv_where = navigation_where( lo_context ).
    ELSE.
      lv_where = key_where( lo_context->mt_key_tab ).
    ENDIF.

    lr_data = lo_source->read( iv_where   = lv_where
                               it_orderby = lt_orderby ).
    ASSIGN lr_data->* TO <lt_data>.
    READ TABLE <lt_data> INDEX 1 ASSIGNING <ls_row>.
    IF sy-subrc = 0.
      es_data = <ls_row>.
    ELSE.
      CLEAR es_data.
    ENDIF.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~get_expanded_entityset.
    DATA lr_data TYPE REF TO data.
    DATA ls_entity TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lo_source TYPE REF TO zif_stg_cds_source.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.

* plain read; the framework expands the navigation properties generically
    ls_entity = entity_of( io_tech_request_context->get_entity_set_name( ) ).
    lo_source = source_of( ls_entity ).
    lr_data = lo_source->read( iv_where   = ''
                               it_orderby = et_expanded_tech_clauses ).
    ASSIGN lr_data->* TO <lt_data>.
    CLEAR <lt_data>.
    if_sadl_gw_dpc~get_entityset( EXPORTING io_tech_request_context = io_tech_request_context
                                  IMPORTING et_data                 = <lt_data>
                                            es_response_context     = es_response_context ).
    er_entityset = lr_data.
    CLEAR et_expanded_tech_clauses.
    ev_entity_mapped_by_sadl = abap_true.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~get_expanded_entity.
    DATA lr_line   TYPE REF TO data.
    DATA ls_entity TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lo_source TYPE REF TO zif_stg_cds_source.
    FIELD-SYMBOLS <ls_row> TYPE any.

    ls_entity = entity_of( io_tech_request_context->get_entity_set_name( ) ).
    lo_source = source_of( ls_entity ).
    lr_line = lo_source->create_line( ).
    ASSIGN lr_line->* TO <ls_row>.
    if_sadl_gw_dpc~get_entity( EXPORTING io_tech_request_context = io_tech_request_context
                               IMPORTING es_data                 = <ls_row> ).
    IF <ls_row> IS NOT INITIAL.
      er_entity = lr_line.
    ENDIF.
    CLEAR et_expanded_tech_clauses.
    ev_entity_mapped_by_sadl = abap_true.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~create_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'SADL CREATE_ENTITY'.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~update_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'SADL UPDATE_ENTITY'.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~delete_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'SADL DELETE_ENTITY'.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~execute_action.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'SADL EXECUTE_ACTION'.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~begin_changeset.
    RETURN.
  ENDMETHOD.

  METHOD if_sadl_gw_dpc~process_changeset.
    RETURN.
  ENDMETHOD.

ENDCLASS.
