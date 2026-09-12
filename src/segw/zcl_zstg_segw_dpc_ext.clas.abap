CLASS zcl_zstg_segw_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_segw_dpc CREATE PUBLIC.
* The developer's half of ZSTG_SEGW_SRV: every ZSTG_SB* set is served by
* the generated base class through the SADL DPC; ImportSet takes an IWPR
* file as Content and replaces the project's rows, ExportSet('P') gives
* the project back as one, DELETE NodeSet(P, uuid) takes a node with its
* subtree (zcl_stg_segw_tree).
  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS importset_create_entity REDEFINITION.
    METHODS exportset_get_entity REDEFINITION.
    METHODS nodeset_delete_entity REDEFINITION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zstg_segw_dpc_ext IMPLEMENTATION.

  METHOD importset_create_entity.
    DATA ls_result TYPE zcl_stg_segw_import=>ty_result.

    io_data_provider->read_entry_data( IMPORTING es_data = er_entity ).
    IF er_entity-content IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'Content is required: the IWPR file as text'.
    ENDIF.
    ls_result = zcl_stg_segw_import=>import( er_entity-content ).
    CLEAR er_entity.
    er_entity-project = ls_result-project.
    er_entity-rows    = ls_result-rows.
    er_entity-tables  = ls_result-tables.
  ENDMETHOD.

  METHOD exportset_get_entity.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'Project'.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'key Project is missing'.
    ENDIF.
    er_entity-project = ls_key-value.
    er_entity-content = zcl_stg_segw_export=>export( ls_key-value ).
  ENDMETHOD.

  METHOD nodeset_delete_entity.
    DATA ls_key     TYPE /iwbep/s_mgw_name_value_pair.
    DATA lv_project TYPE string.
    DATA lv_node    TYPE string.
    DATA lv_rows    TYPE i.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'Project'.
    lv_project = ls_key-value.
    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'NodeUuid'.
    lv_node = ls_key-value.
    IF lv_project IS INITIAL OR lv_node IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'keys Project and NodeUuid are required'.
    ENDIF.
    lv_rows = zcl_stg_segw_tree=>delete_subtree( iv_project = lv_project
                                                 iv_node    = lv_node ).
    IF lv_rows = 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |no node { lv_node } in project { lv_project }|.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
