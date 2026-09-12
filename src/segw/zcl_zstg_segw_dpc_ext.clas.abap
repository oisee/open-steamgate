CLASS zcl_zstg_segw_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_segw_dpc CREATE PUBLIC.
* The developer's half of ZSTG_SEGW_SRV: every ZSTG_SB* set is served by
* the generated base class through the SADL DPC; ImportSet takes an IWPR
* file as Content and replaces the project's rows, ExportSet('P') gives
* the project back as one.
  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS importset_create_entity REDEFINITION.
    METHODS exportset_get_entity REDEFINITION.
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

ENDCLASS.
