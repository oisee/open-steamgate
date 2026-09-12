CLASS zcl_zstg_segw_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_segw_dpc CREATE PUBLIC.
* The developer's half of ZSTG_SEGW_SRV: every ZSTG_SB* set is served by
* the generated base class through the SADL DPC; ImportSet takes an IWPR
* file as Content and replaces the project's rows, ExportSet('P') gives
* the project back as one, DELETE NodeSet(P, uuid) takes a node with its
* subtree (zcl_stg_segw_tree), GenerateSet?$filter=Project eq 'P' is the
* generator (zcl_stg_segw_gen) with the classes as files.
  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS importset_create_entity REDEFINITION.
    METHODS exportset_get_entity REDEFINITION.
    METHODS nodeset_delete_entity REDEFINITION.
    METHODS generateset_get_entityset REDEFINITION.
    METHODS generateset_get_entity REDEFINITION.
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

  METHOD generateset_get_entityset.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.
    DATA lv_project TYPE string.
    DATA lt_files  TYPE zcl_stg_segw_gen=>tt_file.
    DATA ls_file   TYPE zcl_stg_segw_gen=>ty_file.
    DATA ls_entity TYPE zcl_zstg_segw_mpc=>ts_generate.

    LOOP AT it_filter_select_options INTO ls_filter.
      IF to_upper( ls_filter-property ) <> 'PROJECT'.
        CONTINUE.
      ENDIF.
      READ TABLE ls_filter-select_options INDEX 1 INTO ls_option.
      IF sy-subrc = 0 AND ls_option-option = 'EQ'.
        lv_project = ls_option-low.
      ENDIF.
    ENDLOOP.
    IF lv_project IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = `GenerateSet needs $filter=Project eq '...'`.
    ENDIF.
    lt_files = zcl_stg_segw_gen=>generate( lv_project ).
    LOOP AT lt_files INTO ls_file.
      ls_entity-project = lv_project.
      ls_entity-name    = ls_file-name.
      ls_entity-content = ls_file-content.
      APPEND ls_entity TO et_entityset.
    ENDLOOP.
  ENDMETHOD.

  METHOD generateset_get_entity.
    DATA ls_key     TYPE /iwbep/s_mgw_name_value_pair.
    DATA lv_project TYPE string.
    DATA lv_name    TYPE string.
    DATA lt_files   TYPE zcl_stg_segw_gen=>tt_file.
    DATA ls_file    TYPE zcl_stg_segw_gen=>ty_file.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'Project'.
    lv_project = ls_key-value.
    er_entity-project = lv_project.
    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'Name'.
    lv_name = ls_key-value.
    lt_files = zcl_stg_segw_gen=>generate( lv_project ).
    READ TABLE lt_files INTO ls_file WITH KEY name = lv_name.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |{ er_entity-project }: no generated file { lv_name }|.
    ENDIF.
    er_entity-name    = ls_file-name.
    er_entity-content = ls_file-content.
  ENDMETHOD.

ENDCLASS.
