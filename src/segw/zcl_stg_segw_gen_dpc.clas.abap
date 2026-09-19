CLASS zcl_stg_segw_gen_dpc DEFINITION PUBLIC CREATE PUBLIC.
* Stage 2 of segw-gen in ABAP: the data provider base class (_DPC), the
* abapGit XML of the _MPC and _DPC, and the _EXT pair. Templates of
* tools/segw-gen.mjs, line for line; the operations mapped to a function
* module or a search help (stage 3) are stubs here, as segw-gen writes them
* when no function group is given.
  PUBLIC SECTION.
    CLASS-METHODS dpc_source
      IMPORTING
        is_model         TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_source) TYPE string.

    CLASS-METHODS dpc_xml
      IMPORTING
        is_model      TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_xml) TYPE string.

    CLASS-METHODS mpc_xml
      IMPORTING
        is_model      TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_xml) TYPE string.

    CLASS-METHODS ext_sources
      IMPORTING
        is_model        TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rt_files) TYPE zcl_stg_segw_gen=>tt_file.

  PRIVATE SECTION.

* an operation with its entity set and type, in the order of the model
    TYPES: BEGIN OF ty_op,
             type          TYPE string,
             method        TYPE string,
             mapping_kind  TYPE string,
             function_name TYPE string,
             set_name      TYPE string,
             sadl_type     TYPE string,
             sadl_service  TYPE string,
             sadl_set      TYPE string,
             type_stem     TYPE string,
             sort_key      TYPE string,
             op            TYPE zcl_stg_segw_gen=>ty_operation,
             entity        TYPE zcl_stg_segw_gen=>ty_entity_type,
           END OF ty_op.
    TYPES tt_op TYPE STANDARD TABLE OF ty_op WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_named,
             name    TYPE string,
             content TYPE string,
           END OF ty_named.
    TYPES tt_named TYPE STANDARD TABLE OF ty_named WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_sadl_set,
             name       TYPE string,
             sadl_type  TYPE string,
             binding    TYPE string,
             edit_mode  TYPE string,
             properties TYPE zcl_stg_segw_gen=>tt_property,
           END OF ty_sadl_set.
    TYPES tt_sadl_set TYPE STANDARD TABLE OF ty_sadl_set WITH DEFAULT KEY.

    CLASS-METHODS operations
      IMPORTING
        is_model     TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rt_ops) TYPE tt_op.

* the class editor's order of method names: "_" before digits before letters
    CLASS-METHODS sort_key
      IMPORTING
        iv_name       TYPE string
      RETURNING
        VALUE(rv_key) TYPE string.

    CLASS-METHODS header
      IMPORTING
        iv_include     TYPE string
        is_model       TYPE zcl_stg_segw_gen=>ty_model
        iv_double      TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS signature
      IMPORTING
        is_op          TYPE ty_op
        is_model       TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS dispatch
      IMPORTING
        iv_kind        TYPE string
        it_ops         TYPE tt_op
        is_model       TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS comm_services
      RETURNING
        VALUE(rt_impls) TYPE tt_named.

    CLASS-METHODS sadl_methods
      IMPORTING
        is_model        TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rt_impls) TYPE tt_named.

    CLASS-METHODS sadl_delegation
      IMPORTING
        iv_type        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS odc_method
      IMPORTING
        is_op          TYPE ty_op
        is_model       TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS stub
      IMPORTING
        iv_method      TYPE string
        iv_comment     TYPE string OPTIONAL
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS clas_xml
      IMPORTING
        iv_name        TYPE string
        iv_description TYPE string
        it_components  TYPE tt_named OPTIONAL
        it_subs        TYPE string_table OPTIONAL
*       the class's text pool: key and text, in the order the symbols were given
        it_pool        TYPE tt_named OPTIONAL
      RETURNING
        VALUE(rv_xml)  TYPE string.

    CLASS-METHODS xml_text
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS op_subs
      IMPORTING
        iv_type        TYPE string
      RETURNING
        VALUE(rt_subs) TYPE tt_named.
ENDCLASS.

CLASS zcl_stg_segw_gen_dpc IMPLEMENTATION.

  METHOD operations.
    DATA ls_type TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set  TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_o    TYPE zcl_stg_segw_gen=>ty_operation.
    DATA ls_op   TYPE ty_op.

    LOOP AT is_model-entity_types INTO ls_type.
      LOOP AT ls_type-entity_sets INTO ls_set.
        LOOP AT ls_set-operations INTO ls_o.
          CLEAR ls_op.
          ls_op-type          = ls_o-type.
          ls_op-method        = ls_o-method.
          ls_op-mapping_kind  = ls_o-mapping_kind.
          ls_op-function_name = ls_o-function_name.
          ls_op-set_name      = ls_set-name.
          ls_op-sadl_type     = ls_set-sadl_type.
          ls_op-sadl_service  = ls_set-sadl_service.
          ls_op-sadl_set      = ls_set-sadl_set.
          ls_op-type_stem     = ls_type-type_stem.
          ls_op-sort_key      = sort_key( ls_o-method ).
          ls_op-op            = ls_o.
          ls_op-entity        = ls_type.
          APPEND ls_op TO rt_ops.
        ENDLOOP.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD sort_key.
* JavaScript's localeCompare, which segw-gen sorts with, puts "_" before
* digits; a plain sort puts digits first. "/" sorts before both.
    rv_key = replace( val = iv_name sub = '_' with = '/' occ = 0 ).
  ENDMETHOD.

  METHOD header.
* the first line of SEGW's include banner has 94 dashes, the last 95; the
* GET_ENTITY include has 95 in both and a doubled blank before "on"
    DATA lv_first TYPE string.
    DATA lv_last  TYPE string.
    DATA lv_blank TYPE string.

    lv_last = '*&' && repeat( val = '-' occ = 95 ) && '*'.
    IF iv_double = abap_true.
      lv_first = lv_last.
      lv_blank = ` `.
    ELSE.
      lv_first = '*&' && repeat( val = '-' occ = 94 ) && '*'.
    ENDIF.
    rv_text = |{ lv_first }\n|
      && |*&  Include           { iv_include }\n|
      && |*&* This class has been generated { lv_blank }on { is_model-generated_on } in client { is_model-client }\n|
      && |*&*\n|
      && |*&*       WARNING--> NEVER MODIFY THIS CLASS <--WARNING\n|
      && |*&*   If you want to change the DPC implementation, use the\n|
      && |*&*   generated methods inside the DPC provider subclass - { is_model-dpc_ext }\n|
      && |{ lv_last }\n|.
  ENDMETHOD.

  METHOD signature.
    CASE is_op-type.
      WHEN 'C'.
        rv_text = |    importing\n|
          && |      !IV_ENTITY_NAME type STRING\n|
          && |      !IV_ENTITY_SET_NAME type STRING\n|
          && |      !IV_SOURCE_NAME type STRING\n|
          && |      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR\n|
          && |      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_C optional\n|
          && |      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH\n|
          && |      !IO_DATA_PROVIDER type ref to /IWBEP/IF_MGW_ENTRY_PROVIDER optional\n|
          && |    exporting\n|
          && |      !ER_ENTITY type { is_model-mpc }=>TS_{ is_op-type_stem }\n|
          && |    raising\n|
          && |      /IWBEP/CX_MGW_BUSI_EXCEPTION\n|
          && |      /IWBEP/CX_MGW_TECH_EXCEPTION .\n|.
      WHEN 'D'.
        rv_text = |    importing\n|
          && |      !IV_ENTITY_NAME type STRING\n|
          && |      !IV_ENTITY_SET_NAME type STRING\n|
          && |      !IV_SOURCE_NAME type STRING\n|
          && |      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR\n|
          && |      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_D optional\n|
          && |      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH\n|
          && |    raising\n|
          && |      /IWBEP/CX_MGW_BUSI_EXCEPTION\n|
          && |      /IWBEP/CX_MGW_TECH_EXCEPTION .\n|.
      WHEN 'R'.
        rv_text = |    importing\n|
          && |      !IV_ENTITY_NAME type STRING\n|
          && |      !IV_ENTITY_SET_NAME type STRING\n|
          && |      !IV_SOURCE_NAME type STRING\n|
          && |      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR\n|
          && |      !IO_REQUEST_OBJECT type ref to /IWBEP/IF_MGW_REQ_ENTITY optional\n|
          && |      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY optional\n|
          && |      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH\n|
          && |    exporting\n|
          && |      !ER_ENTITY type { is_model-mpc }=>TS_{ is_op-type_stem }\n|
          && |      !ES_RESPONSE_CONTEXT type /IWBEP/IF_MGW_APPL_SRV_RUNTIME=>TY_S_MGW_RESPONSE_ENTITY_CNTXT\n|
          && |    raising\n|
          && |      /IWBEP/CX_MGW_BUSI_EXCEPTION\n|
          && |      /IWBEP/CX_MGW_TECH_EXCEPTION .\n|.
      WHEN 'Q'.
        rv_text = |    importing\n|
          && |      !IV_ENTITY_NAME type STRING\n|
          && |      !IV_ENTITY_SET_NAME type STRING\n|
          && |      !IV_SOURCE_NAME type STRING\n|
          && |      !IT_FILTER_SELECT_OPTIONS type /IWBEP/T_MGW_SELECT_OPTION\n|
          && |      !IS_PAGING type /IWBEP/S_MGW_PAGING\n|
          && |      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR\n|
          && |      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH\n|
          && |      !IT_ORDER type /IWBEP/T_MGW_SORTING_ORDER\n|
          && |      !IV_FILTER_STRING type STRING\n|
          && |      !IV_SEARCH_STRING type STRING\n|
          && |      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITYSET optional\n|
          && |    exporting\n|
          && |      !ET_ENTITYSET type { is_model-mpc }=>TT_{ is_op-type_stem }\n|
          && |      !ES_RESPONSE_CONTEXT type /IWBEP/IF_MGW_APPL_SRV_RUNTIME=>TY_S_MGW_RESPONSE_CONTEXT\n|
          && |    raising\n|
          && |      /IWBEP/CX_MGW_BUSI_EXCEPTION\n|
          && |      /IWBEP/CX_MGW_TECH_EXCEPTION .\n|.
      WHEN 'U'.
        rv_text = |    importing\n|
          && |      !IV_ENTITY_NAME type STRING\n|
          && |      !IV_ENTITY_SET_NAME type STRING\n|
          && |      !IV_SOURCE_NAME type STRING\n|
          && |      !IT_KEY_TAB type /IWBEP/T_MGW_NAME_VALUE_PAIR\n|
          && |      !IO_TECH_REQUEST_CONTEXT type ref to /IWBEP/IF_MGW_REQ_ENTITY_U optional\n|
          && |      !IT_NAVIGATION_PATH type /IWBEP/T_MGW_NAVIGATION_PATH\n|
          && |      !IO_DATA_PROVIDER type ref to /IWBEP/IF_MGW_ENTRY_PROVIDER optional\n|
          && |    exporting\n|
          && |      !ER_ENTITY type { is_model-mpc }=>TS_{ is_op-type_stem }\n|
          && |    raising\n|
          && |      /IWBEP/CX_MGW_BUSI_EXCEPTION\n|
          && |      /IWBEP/CX_MGW_TECH_EXCEPTION .\n|.
    ENDCASE.
  ENDMETHOD.

  METHOD dispatch.
    DATA lv_mpc   TYPE string.
    DATA ls_op    TYPE ty_op.
    DATA lv_decls TYPE string.
    DATA lv_m     TYPE string.
    DATA lv_tab   TYPE string.
    DATA lv_kind  TYPE string.

    lv_mpc = to_lower( is_model-mpc ).
    lv_tab = cl_abap_char_utilities=>horizontal_tab.
    IF iv_kind = 'Q'.
      lv_kind = 'tt'.
    ELSE.
      lv_kind = 'ts'.
    ENDIF.
    LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
      lv_decls = lv_decls && | DATA { to_lower( ls_op-method ) } TYPE { lv_mpc }=>{ lv_kind }_{ to_lower( ls_op-type_stem ) }.\n|.
    ENDLOOP.

    CASE iv_kind.
      WHEN 'C'.
        rv_text = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_ENTITY.\n|
          && header( iv_include = '/IWBEP/DPC_TEMP_CRT_ENTITY_BASE' is_model = is_model )
          && |\n{ lv_decls } DATA lv_entityset_name TYPE string.\n|
          && |\nlv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && |\nCASE lv_entityset_name.\n|.
        LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
          lv_m = to_lower( ls_op-method ).
          rv_text = rv_text
            && |*-------------------------------------------------------------------------*\n|
            && |*             EntitySet -  { ls_op-set_name }\n|
            && |*-------------------------------------------------------------------------*\n|
            && |     WHEN '{ ls_op-set_name }'.\n|
            && |*     Call the entity set generated method\n|
            && |    { lv_m }(\n|
            && |         EXPORTING iv_entity_name     = iv_entity_name\n|
            && |                   iv_entity_set_name = iv_entity_set_name\n|
            && |                   iv_source_name     = iv_source_name\n|
            && |                   io_data_provider   = io_data_provider\n|
            && |                   it_key_tab         = it_key_tab\n|
            && |                   it_navigation_path = it_navigation_path\n|
            && |                   io_tech_request_context = io_tech_request_context\n|
            && |       { lv_tab } IMPORTING er_entity          = { lv_m }\n|
            && |    ).\n|
            && |*     Send specific entity data to the caller interfaces\n|
            && |    copy_data_to_ref(\n|
            && |      EXPORTING\n|
            && |        is_data = { lv_m }\n|
            && |      CHANGING\n|
            && |        cr_data = er_entity\n|
            && |   ).\n|
            && |\n|.
        ENDLOOP.
        rv_text = rv_text
          && |  when others.\n|
          && |    super->/iwbep/if_mgw_appl_srv_runtime~create_entity(\n|
          && |       EXPORTING\n|
          && |         iv_entity_name = iv_entity_name\n|
          && |         iv_entity_set_name = iv_entity_set_name\n|
          && |         iv_source_name = iv_source_name\n|
          && |         io_data_provider   = io_data_provider\n|
          && |         it_key_tab = it_key_tab\n|
          && |         it_navigation_path = it_navigation_path\n|
          && |      IMPORTING\n|
          && |        er_entity = er_entity\n|
          && |  ).\n|
          && |ENDCASE.\n|
          && |  endmethod.\n|.
      WHEN 'D'.
        rv_text = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~DELETE_ENTITY.\n|
          && header( iv_include = '/IWBEP/DPC_TEMP_DEL_ENTITY_BASE' is_model = is_model )
          && |\n DATA lv_entityset_name TYPE string.\n|
          && |\nlv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && |\nCASE lv_entityset_name.\n|.
        LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
          lv_m = to_lower( ls_op-method ).
          rv_text = rv_text
            && |*-------------------------------------------------------------------------*\n|
            && |*             EntitySet -  { ls_op-set_name }\n|
            && |*-------------------------------------------------------------------------*\n|
            && |      when '{ ls_op-set_name }'.\n|
            && |*     Call the entity set generated method\n|
            && |     { lv_m }(\n|
            && |          EXPORTING iv_entity_name     = iv_entity_name\n|
            && |                    iv_entity_set_name = iv_entity_set_name\n|
            && |                    iv_source_name     = iv_source_name\n|
            && |                    it_key_tab         = it_key_tab\n|
            && |                    it_navigation_path = it_navigation_path\n|
            && |                    io_tech_request_context = io_tech_request_context\n|
            && |     ).\n|
            && |\n|.
        ENDLOOP.
        rv_text = rv_text
          && |   when others.\n|
          && |     super->/iwbep/if_mgw_appl_srv_runtime~delete_entity(\n|
          && |        EXPORTING\n|
          && |          iv_entity_name = iv_entity_name\n|
          && |          iv_entity_set_name = iv_entity_set_name\n|
          && |          iv_source_name = iv_source_name\n|
          && |          it_key_tab = it_key_tab\n|
          && |          it_navigation_path = it_navigation_path\n|
          && | ).\n|
          && | ENDCASE.\n|
          && |  endmethod.\n|.
      WHEN 'R'.
        rv_text = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITY.\n|
          && header( iv_include = '/IWBEP/DPC_TEMP_GETENTITY_BASE' is_model = is_model iv_double = abap_true )
          && |\n{ lv_decls } DATA lv_entityset_name TYPE string.\n|
          && | DATA lr_entity TYPE REF TO data.       "#EC NEEDED\n|
          && |\nlv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && |\nCASE lv_entityset_name.\n|.
        LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
          lv_m = to_lower( ls_op-method ).
          rv_text = rv_text
            && |*-------------------------------------------------------------------------*\n|
            && |*             EntitySet -  { ls_op-set_name }\n|
            && |*-------------------------------------------------------------------------*\n|
            && |      WHEN '{ ls_op-set_name }'.\n|
            && |*     Call the entity set generated method\n|
            && |          { lv_m }(\n|
            && |               EXPORTING iv_entity_name     = iv_entity_name\n|
            && |                         iv_entity_set_name = iv_entity_set_name\n|
            && |                         iv_source_name     = iv_source_name\n|
            && |                         it_key_tab         = it_key_tab\n|
            && |                         it_navigation_path = it_navigation_path\n|
            && |                         io_tech_request_context = io_tech_request_context\n|
            && |             { lv_tab } IMPORTING er_entity          = { lv_m }\n|
            && |                         es_response_context = es_response_context\n|
            && |          ).\n|
            && |\n|
            && |        IF { lv_m } IS NOT INITIAL.\n|
            && |*     Send specific entity data to the caller interface\n|
            && |          copy_data_to_ref(\n|
            && |            EXPORTING\n|
            && |              is_data = { lv_m }\n|
            && |            CHANGING\n|
            && |              cr_data = er_entity\n|
            && |          ).\n|
            && |        ELSE.\n|
            && |*         In case of initial values - unbind the entity reference\n|
            && |          er_entity = lr_entity.\n|
            && |        ENDIF.\n|.
        ENDLOOP.
        rv_text = rv_text
          && |\n      WHEN OTHERS.\n|
          && |        super->/iwbep/if_mgw_appl_srv_runtime~get_entity(\n|
          && |           EXPORTING\n|
          && |             iv_entity_name = iv_entity_name\n|
          && |             iv_entity_set_name = iv_entity_set_name\n|
          && |             iv_source_name = iv_source_name\n|
          && |             it_key_tab = it_key_tab\n|
          && |             it_navigation_path = it_navigation_path\n|
          && |          IMPORTING\n|
          && |            er_entity = er_entity\n|
          && |    ).\n|
          && | ENDCASE.\n|
          && |  endmethod.\n|.
      WHEN 'Q'.
        rv_text = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITYSET.\n|
          && header( iv_include = '/IWBEP/DPC_TMP_ENTITYSET_BASE' is_model = is_model )
          && |{ lv_decls } DATA lv_entityset_name TYPE string.\n|
          && |\nlv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && |\nCASE lv_entityset_name.\n|.
        LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
          lv_m = to_lower( ls_op-method ).
          rv_text = rv_text
            && |*-------------------------------------------------------------------------*\n|
            && |*             EntitySet -  { ls_op-set_name }\n|
            && |*-------------------------------------------------------------------------*\n|
            && |   WHEN '{ ls_op-set_name }'.\n|
            && |*     Call the entity set generated method\n|
            && |      { lv_m }(\n|
            && |        EXPORTING\n|
            && |         iv_entity_name = iv_entity_name\n|
            && |         iv_entity_set_name = iv_entity_set_name\n|
            && |         iv_source_name = iv_source_name\n|
            && |         it_filter_select_options = it_filter_select_options\n|
            && |         it_order = it_order\n|
            && |         is_paging = is_paging\n|
            && |         it_navigation_path = it_navigation_path\n|
            && |         it_key_tab = it_key_tab\n|
            && |         iv_filter_string = iv_filter_string\n|
            && |         iv_search_string = iv_search_string\n|
            && |         io_tech_request_context = io_tech_request_context\n|
            && |       IMPORTING\n|
            && |         et_entityset = { lv_m }\n|
            && |         es_response_context = es_response_context\n|
            && |       ).\n|
            && |*     Send specific entity data to the caller interface\n|
            && |      copy_data_to_ref(\n|
            && |        EXPORTING\n|
            && |          is_data = { lv_m }\n|
            && |        CHANGING\n|
            && |          cr_data = er_entityset\n|
            && |      ).\n|
            && |\n|.
        ENDLOOP.
        rv_text = rv_text
          && |    WHEN OTHERS.\n|
          && |      super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(\n|
          && |        EXPORTING\n|
          && |          iv_entity_name = iv_entity_name\n|
          && |          iv_entity_set_name = iv_entity_set_name\n|
          && |          iv_source_name = iv_source_name\n|
          && |          it_filter_select_options = it_filter_select_options\n|
          && |          it_order = it_order\n|
          && |          is_paging = is_paging\n|
          && |          it_navigation_path = it_navigation_path\n|
          && |          it_key_tab = it_key_tab\n|
          && |          iv_filter_string = iv_filter_string\n|
          && |          iv_search_string = iv_search_string\n|
          && |          io_tech_request_context = io_tech_request_context\n|
          && |       IMPORTING\n|
          && |         er_entityset = er_entityset ).\n|
          && | ENDCASE.\n|
          && |  endmethod.\n|.
      WHEN 'U'.
        rv_text = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~UPDATE_ENTITY.\n|
          && header( iv_include = '/IWBEP/DPC_TEMP_UPD_ENTITY_BASE' is_model = is_model )
          && |\n{ lv_decls } DATA lv_entityset_name TYPE string.\n|
          && | DATA lr_entity TYPE REF TO data. "#EC NEEDED\n|
          && |\nlv_entityset_name = io_tech_request_context->get_entity_set_name( ).\n|
          && |\nCASE lv_entityset_name.\n|.
        LOOP AT it_ops INTO ls_op WHERE type = iv_kind.
          lv_m = to_lower( ls_op-method ).
          rv_text = rv_text
            && |*-------------------------------------------------------------------------*\n|
            && |*             EntitySet -  { ls_op-set_name }\n|
            && |*-------------------------------------------------------------------------*\n|
            && |      WHEN '{ ls_op-set_name }'.\n|
            && |*     Call the entity set generated method\n|
            && |          { lv_m }(\n|
            && |               EXPORTING iv_entity_name     = iv_entity_name\n|
            && |                         iv_entity_set_name = iv_entity_set_name\n|
            && |                         iv_source_name     = iv_source_name\n|
            && |                         io_data_provider   = io_data_provider\n|
            && |                         it_key_tab         = it_key_tab\n|
            && |                         it_navigation_path = it_navigation_path\n|
            && |                         io_tech_request_context = io_tech_request_context\n|
            && |             { lv_tab } IMPORTING er_entity          = { lv_m }\n|
            && |          ).\n|
            && |       IF { lv_m } IS NOT INITIAL.\n|
            && |*     Send specific entity data to the caller interface\n|
            && |          copy_data_to_ref(\n|
            && |            EXPORTING\n|
            && |              is_data = { lv_m }\n|
            && |            CHANGING\n|
            && |              cr_data = er_entity\n|
            && |          ).\n|
            && |        ELSE.\n|
            && |*         In case of initial values - unbind the entity reference\n|
            && |          er_entity = lr_entity.\n|
            && |        ENDIF.\n|.
        ENDLOOP.
        rv_text = rv_text
          && |      WHEN OTHERS.\n|
          && |        super->/iwbep/if_mgw_appl_srv_runtime~update_entity(\n|
          && |           EXPORTING\n|
          && |             iv_entity_name = iv_entity_name\n|
          && |             iv_entity_set_name = iv_entity_set_name\n|
          && |             iv_source_name = iv_source_name\n|
          && |             io_data_provider   = io_data_provider\n|
          && |             it_key_tab = it_key_tab\n|
          && |             it_navigation_path = it_navigation_path\n|
          && |          IMPORTING\n|
          && |            er_entity = er_entity\n|
          && |    ).\n|
          && | ENDCASE.\n|
          && |  endmethod.\n|.
    ENDCASE.
  ENDMETHOD.

  METHOD comm_services.
    DATA ls_impl TYPE ty_named.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~COMMIT_WORK'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~COMMIT_WORK.\n|
      && |* Call RFC commit work functionality\n|
      && |DATA lt_message      TYPE bapiret2. "#EC NEEDED\n|
      && |DATA lv_message_text TYPE BAPI_MSG.\n|
      && |DATA lo_logger       TYPE REF TO /iwbep/cl_cos_logger.\n|
      && |DATA lv_subrc        TYPE syst-subrc.\n|
      && |\n|
      && |lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).\n|
      && |\n|
      && |  IF iv_rfc_dest IS INITIAL OR iv_rfc_dest EQ 'NONE'.\n|
      && |    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'\n|
      && |      EXPORTING\n|
      && |      wait   = abap_true\n|
      && |    IMPORTING\n|
      && |      return = lt_message.\n|
      && |  ELSE.\n|
      && |    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'\n|
      && |      DESTINATION iv_rfc_dest\n|
      && |    EXPORTING\n|
      && |      wait                  = abap_true\n|
      && |    IMPORTING\n|
      && |      return                = lt_message\n|
      && |    EXCEPTIONS\n|
      && |      communication_failure = 1000 MESSAGE lv_message_text\n|
      && |      system_failure        = 1001 MESSAGE lv_message_text\n|
      && |      OTHERS                = 1002.\n|
      && |\n|
      && |  IF sy-subrc <> 0.\n|
      && |    lv_subrc = sy-subrc.\n|
      && |    /iwbep/cl_sb_gen_dpc_rt_util=>rfc_exception_handling(\n|
      && |        EXPORTING\n|
      && |          iv_subrc            = lv_subrc\n|
      && |          iv_exp_message_text = lv_message_text\n|
      && |          io_logger           = lo_logger ).\n|
      && |  ENDIF.\n|
      && |  ENDIF.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~GET_GENERATION_STRATEGY'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~GET_GENERATION_STRATEGY.\n|
      && |* Get generation strategy\n|
      && |  rv_generation_strategy = '1'.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~LOG_MESSAGE'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~LOG_MESSAGE.\n|
      && |* Log message in the application log\n|
      && |DATA lo_logger TYPE REF TO /iwbep/cl_cos_logger.\n|
      && |DATA lv_text TYPE /iwbep/sup_msg_longtext.\n|
      && |\n|
      && |  MESSAGE ID iv_msg_id TYPE iv_msg_type NUMBER iv_msg_number\n|
      && |    WITH iv_msg_v1 iv_msg_v2 iv_msg_v3 iv_msg_v4 INTO lv_text.\n|
      && |\n|
      && |  lo_logger = mo_context->get_logger( ).\n|
      && |  lo_logger->log_message(\n|
      && |    EXPORTING\n|
      && |     iv_msg_type   = iv_msg_type\n|
      && |     iv_msg_id     = iv_msg_id\n|
      && |     iv_msg_number = iv_msg_number\n|
      && |     iv_msg_text   = lv_text\n|
      && |     iv_msg_v1     = iv_msg_v1\n|
      && |     iv_msg_v2     = iv_msg_v2\n|
      && |     iv_msg_v3     = iv_msg_v3\n|
      && |     iv_msg_v4     = iv_msg_v4\n|
      && |     iv_agent      = 'DPC' ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_EXCEPTION_HANDLING'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_EXCEPTION_HANDLING.\n|
      && |* RFC call exception handling\n|
      && |DATA lo_logger  TYPE REF TO /iwbep/cl_cos_logger.\n|
      && |\n|
      && |lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).\n|
      && |\n|
      && |/iwbep/cl_sb_gen_dpc_rt_util=>rfc_exception_handling(\n|
      && |  EXPORTING\n|
      && |    iv_subrc            = iv_subrc\n|
      && |    iv_exp_message_text = iv_exp_message_text\n|
      && |    io_logger           = lo_logger ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_SAVE_LOG'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~RFC_SAVE_LOG.\n|
      && |  DATA lo_logger  TYPE REF TO /iwbep/cl_cos_logger.\n|
      && |  DATA lo_message_container TYPE REF TO /iwbep/if_message_container.\n|
      && |\n|
      && |  lo_logger = /iwbep/if_mgw_conv_srv_runtime~get_logger( ).\n|
      && |  lo_message_container = /iwbep/if_mgw_conv_srv_runtime~get_message_container( ).\n|
      && |\n|
      && |  " Save the RFC call log in the application log\n|
      && |  /iwbep/cl_sb_gen_dpc_rt_util=>rfc_save_log(\n|
      && |    EXPORTING\n|
      && |      is_return            = is_return\n|
      && |      iv_entity_type       = iv_entity_type\n|
      && |      it_return            = it_return\n|
      && |      it_key_tab           = it_key_tab\n|
      && |      io_logger            = lo_logger\n|
      && |      io_message_container = lo_message_container ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = '/IWBEP/IF_SB_DPC_COMM_SERVICES~SET_INJECTION'.
    ls_impl-content = |  method /IWBEP/IF_SB_DPC_COMM_SERVICES~SET_INJECTION.\n|
      && |* Unit test injection\n|
      && |  IF io_unit IS BOUND.\n|
      && |    mo_injection = io_unit.\n|
      && |  ELSE.\n|
      && |    mo_injection = me.\n|
      && |  ENDIF.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.

    ls_impl-name    = 'CHECK_SUBSCRIPTION_AUTHORITY'.
    ls_impl-content = |  method CHECK_SUBSCRIPTION_AUTHORITY.\n|
      && |  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc\n|
      && |    EXPORTING\n|
      && |      textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented\n|
      && |      method = 'CHECK_SUBSCRIPTION_AUTHORITY'.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
  ENDMETHOD.

  METHOD sadl_delegation.
    CASE iv_type.
      WHEN 'C'.
        rv_text = |    if_sadl_gw_dpc_util~get_dpc( )->create_entity( EXPORTING io_data_provider        = io_data_provider\n|
          && |                                                             io_tech_request_context = io_tech_request_context\n|
          && |                                                   IMPORTING es_data                 = er_entity ).|.
      WHEN 'D'.
        rv_text = |    if_sadl_gw_dpc_util~get_dpc( )->delete_entity( io_tech_request_context ).|.
      WHEN 'R'.
        rv_text = |    if_sadl_gw_dpc_util~get_dpc( )->get_entity( EXPORTING io_tech_request_context = io_tech_request_context\n|
          && |                                                IMPORTING es_data                 = er_entity ).|.
      WHEN 'Q'.
        rv_text = |    if_sadl_gw_dpc_util~get_dpc( )->get_entityset( EXPORTING io_tech_request_context = io_tech_request_context\n|
          && |                                                   IMPORTING et_data                 = et_entityset\n|
          && |                                                             es_response_context     = es_response_context ).|.
      WHEN 'U'.
        rv_text = |    if_sadl_gw_dpc_util~get_dpc( )->update_entity( EXPORTING io_tech_request_context = io_tech_request_context\n|
          && |                                                             io_data_provider        = io_data_provider\n|
          && |                                                   IMPORTING es_data                 = er_entity ).|.
    ENDCASE.
  ENDMETHOD.

  METHOD odc_method.
* steamgate's local ODC: the operation is served by another service of
* the registry through zcl_stg_odata_client (reads only)
    DATA lv_head TYPE string.

    lv_head = |  method { is_op-method }.\n|
      && |    DATA lo_client TYPE REF TO zcl_stg_odata_client.\n|
      && |\n|
      && |* served by { is_op-sadl_service }/{ is_op-sadl_set }, another service of this registry\n|
      && |    CREATE OBJECT lo_client\n|
      && |      EXPORTING\n|
      && |        iv_service    = '{ is_op-sadl_service }'\n|
      && |        iv_entity_set = '{ is_op-sadl_set }'.\n|.
    IF is_op-type = 'Q'.
      rv_text = lv_head
        && |    lo_client->get_entityset(\n|
        && |      EXPORTING\n|
        && |        io_tech_request_context = io_tech_request_context\n|
        && |        iv_local_service        = '{ is_model-service }'\n|
        && |        iv_local_set            = iv_entity_set_name\n|
        && |      IMPORTING\n|
        && |        et_entityset            = et_entityset\n|
        && |        es_response_context     = es_response_context ).\n|
        && |  endmethod.\n|.
    ELSEIF is_op-type = 'R'.
      rv_text = lv_head
        && |    lo_client->get_entity(\n|
        && |      EXPORTING\n|
        && |        it_key_tab       = it_key_tab\n|
        && |        iv_local_service = '{ is_model-service }'\n|
        && |        iv_local_set     = iv_entity_set_name\n|
        && |      IMPORTING\n|
        && |        es_entity        = er_entity ).\n|
        && |  endmethod.\n|.
    ENDIF.
  ENDMETHOD.

  METHOD stub.
    rv_text = |  method { iv_method }.\n|
      && iv_comment
      && |  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc\n|
      && |    EXPORTING\n|
      && |      textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented\n|
      && |      method = '{ iv_method }'.\n|
      && |  endmethod.\n|.
  ENDMETHOD.

  METHOD sadl_methods.
    DATA ls_type     TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set      TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_sadl     TYPE ty_sadl_set.
    DATA lt_sadl     TYPE tt_sadl_set.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.
    DATA ls_impl     TYPE ty_named.
    DATA lv_refs     TYPE string.
    DATA lt_lines    TYPE string_table.
    DATA lv_line     TYPE string.
    DATA lv_xml      TYPE string.
    DATA lv_i        TYPE i.
    DATA lv_key      TYPE string.
    DATA lv_n        TYPE i.

    LOOP AT is_model-entity_types INTO ls_type.
      LOOP AT ls_type-entity_sets INTO ls_set.
        IF ls_set-sadl_type IS INITIAL OR ls_set-sadl_type = 'ODC'.
          CONTINUE.
        ENDIF.
        ls_sadl-name       = ls_set-name.
        ls_sadl-sadl_type  = ls_set-sadl_type.
        ls_sadl-binding    = ls_set-sadl_binding.
* maxEditMode follows what the tree says the set allows: EX where it is
* creatable, updatable or deletable, RO otherwise (S_EPM_CDS_EXP writes EX
* for its two writable sets, every read-only project in the corpus writes RO)
        IF ls_set-creatable = abap_true OR ls_set-updatable = abap_true OR ls_set-deletable = abap_true.
          ls_sadl-edit_mode = 'EX'.
        ELSE.
          ls_sadl-edit_mode = 'RO'.
        ENDIF.
        ls_sadl-properties = ls_type-properties.
        APPEND ls_sadl TO lt_sadl.
      ENDLOOP.
    ENDLOOP.
* a where-used reference to the DDIC object behind each set; an EPM
* business object node is not a DDIC type, so it gets none
    lv_i = 0.
    LOOP AT lt_sadl INTO ls_sadl.
      lv_i = lv_i + 1.
      IF ls_sadl-sadl_type = 'EPM'.
        CONTINUE.
      ENDIF.
      IF lv_refs IS NOT INITIAL.
        lv_refs = lv_refs && |\n|.
      ENDIF.
      lv_refs = lv_refs && |    TYPES ty_{ ls_sadl-binding }_{ lv_i } TYPE { to_lower( ls_sadl-binding ) } ##NEEDED. " reference for where-used list|.
    ENDLOOP.
* the lines of the definition: the data sources, the result set with one
* structure per set (in reverse order, as SEGW writes them)
    LOOP AT lt_sadl INTO ls_sadl.
      APPEND |               \| <sadl:dataSource type="{ ls_sadl-sadl_type }" name="{ ls_sadl-name }" binding="{ ls_sadl-binding }" />\| &| TO lt_lines.
    ENDLOOP.
    APPEND `               |<sadl:resultSet>| &` TO lt_lines.
    lv_n = lines( lt_sadl ).
    WHILE lv_n > 0.
      READ TABLE lt_sadl INDEX lv_n INTO ls_sadl.
      APPEND |               \|<sadl:structure name="{ ls_sadl-name }" dataSource="{ ls_sadl-name }" maxEditMode="{ ls_sadl-edit_mode }" >\| &| TO lt_lines.
      APPEND `               | <sadl:query name="EntitySetDefault">| &` TO lt_lines.
      APPEND `               | </sadl:query>| &` TO lt_lines.
      LOOP AT ls_sadl-properties INTO ls_property.
        IF ls_property-is_key = abap_true.
          lv_key = 'TRUE'.
        ELSE.
          lv_key = 'FALSE'.
        ENDIF.
        APPEND |               \| <sadl:attribute name="{ ls_property-abap_field }" binding="{ ls_property-abap_field }" isOutput="TRUE" isKey="{ lv_key }" />\| &| TO lt_lines.
      ENDLOOP.
      APPEND `               |</sadl:structure>| &` TO lt_lines.
      lv_n = lv_n - 1.
    ENDWHILE.
    APPEND `               |</sadl:resultSet>| &` TO lt_lines.
* SEGW writes the whole definition as one & chain, and so does this. It used
* to be built in pieces of 200 lines, because the transpiler nested such a
* chain one concat( ) call per operand and a service worker's stack gave out
* near 800 lines (ZSTG_SEGW: 55 sets). abaplint/transpiler#1836 flattens the
* whole chain into one call, released in 2.13.87; measured at 1200 operands,
* one concat( ), no recursion left to run out of.
* ANORMALIES: transpiler-concat-chain.
    lv_xml = |    DATA(lv_sadl_xml) =\n|
      && |               \|<?xml version="1.0" encoding="utf-16"?>\| &\n|
      && |               \|<sadl:definition xmlns:sadl="http://sap.com/sap.nw.f.sadl" syntaxVersion="V2" >\| &\n|.
    LOOP AT lt_lines INTO lv_line.
      lv_xml = lv_xml && lv_line && |\n|.
    ENDLOOP.
    lv_xml = lv_xml && |               \|</sadl:definition>\| .|.

    ls_impl-name    = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_DEEP_ENTITY'.
    ls_impl-content = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_DEEP_ENTITY.\n|
      && |    CAST /iwbep/if_mgw_appl_srv_runtime( if_sadl_gw_dpc_util~get_dpc( ) )->create_deep_entity(\n|
      && |                   EXPORTING io_tech_request_context = io_tech_request_context\n|
      && |                             io_data_provider        = io_data_provider\n|
      && |                             io_expand               = io_expand\n|
      && |                   IMPORTING er_deep_entity          = er_deep_entity ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~EXECUTE_ACTION'.
    ls_impl-content = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~EXECUTE_ACTION.\n|
      && |    if_sadl_gw_dpc_util~get_dpc( )->execute_action( EXPORTING io_tech_request_context = io_tech_request_context\n|
      && |                                                    IMPORTING er_data                 = er_data ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDITIONAL_IMPLEMENTED'.
    ls_impl-content = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDITIONAL_IMPLEMENTED.\n|
      && |    TRY.\n|
      && |        rv_conditional_active = if_sadl_gw_dpc_util~get_dpc( )->get_is_conditional_implemented(\n|
      && |                                               iv_operation_type  = iv_operation_type\n|
      && |                                               iv_entity_set_name = iv_entity_set_name ).\n|
      && |      CATCH /iwbep/cx_mgw_tech_exception /iwbep/cx_mgw_busi_exception.\n|
      && |        rv_conditional_active = super->/iwbep/if_mgw_appl_srv_runtime~get_is_conditional_implemented(\n|
      && |                                       iv_operation_type     = iv_operation_type\n|
      && |                                       iv_entity_set_name    = iv_entity_set_name ).\n|
      && |    ENDTRY.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDI_IMPLE_FOR_ACTION'.
    ls_impl-content = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_IS_CONDI_IMPLE_FOR_ACTION.\n|
      && |    TRY.\n|
      && |        rv_conditional_active = if_sadl_gw_dpc_util~get_dpc( )->get_is_condi_imple_for_action( iv_action_name ).\n|
      && |      CATCH /iwbep/cx_mgw_tech_exception /iwbep/cx_mgw_busi_exception.\n|
      && |        rv_conditional_active = super->/iwbep/if_mgw_appl_srv_runtime~get_is_condi_imple_for_action( iv_action_name ).\n|
      && |    ENDTRY.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = '/IWBEP/IF_MGW_APPL_SRV_RUNTIME~PATCH_ENTITY'.
    ls_impl-content = |  method /IWBEP/IF_MGW_APPL_SRV_RUNTIME~PATCH_ENTITY.\n|
      && |        super->/iwbep/if_mgw_appl_srv_runtime~patch_entity(\n|
      && |                       EXPORTING io_tech_request_context = io_tech_request_context\n|
      && |                                 io_data_provider        = io_data_provider\n|
      && |                                 iv_entity_name          = iv_entity_name\n|
      && |                                 iv_entity_set_name      = iv_entity_set_name\n|
      && |                                 iv_source_name          = iv_source_name\n|
      && |                                 it_key_tab              = it_key_tab\n|
      && |                                 it_navigation_path      = it_navigation_path\n|
      && |                       IMPORTING er_entity               = er_entity  ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = 'IF_SADL_GW_DPC_UTIL~GET_DPC'.
    ls_impl-content = |  method IF_SADL_GW_DPC_UTIL~GET_DPC.\n|
      && lv_refs && |\n|
      && |\n|
      && lv_xml && |\n|
      && |    ro_dpc = cl_sadl_gw_dpc_factory=>create_for_sadl( iv_sadl_xml   = lv_sadl_xml\n|
      && |               iv_timestamp         = { is_model-generated_at }\n|
      && |               iv_uuid              = '{ is_model-project }'\n|
      && |               io_query_control     = me\n|
      && |               io_extension_control = me\n|
      && |               io_context           = me->mo_context ).\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = 'IF_SADL_GW_EXTENSION_CONTROL~SET_EXTENSION_MAPPING'.
    ls_impl-content = |  method IF_SADL_GW_EXTENSION_CONTROL~SET_EXTENSION_MAPPING.\n|
      && |" Intended to be overwritten\n|
      && |RETURN.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
    ls_impl-name    = 'IF_SADL_GW_QUERY_CONTROL~SET_QUERY_OPTIONS'.
    ls_impl-content = |  method IF_SADL_GW_QUERY_CONTROL~SET_QUERY_OPTIONS.\n|
      && |" Intended to be overwritten\n|
      && |RETURN.\n|
      && |  endmethod.\n|.
    APPEND ls_impl TO rt_impls.
  ENDMETHOD.

  METHOD dpc_source.
    DATA lt_ops     TYPE tt_op.
    DATA lt_sorted  TYPE tt_op.
    DATA ls_op      TYPE ty_op.
    DATA lt_kinds   TYPE string_table.
    DATA lv_kind    TYPE string.
    DATA lv_sadl    TYPE abap_bool.
    DATA lv_shlp    TYPE abap_bool.
    DATA lt_redefs  TYPE string_table.
    DATA lv_name    TYPE string.
    DATA lt_impls   TYPE tt_named.
    DATA ls_impl    TYPE ty_named.
    DATA lv_first   TYPE abap_bool.

    lt_ops = operations( is_model ).
    LOOP AT lt_ops INTO ls_op.
      READ TABLE lt_kinds WITH KEY table_line = ls_op-type TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        APPEND ls_op-type TO lt_kinds.
      ENDIF.
      IF ls_op-sadl_type IS NOT INITIAL AND ls_op-sadl_type <> 'ODC'.
        lv_sadl = abap_true.
      ENDIF.
      IF ls_op-mapping_kind = 'SHLP'.
        lv_shlp = abap_true.
      ENDIF.
    ENDLOOP.
    rv_source = |class { is_model-dpc } definition\n|
      && |  public\n|
      && |  inheriting from /IWBEP/CL_MGW_PUSH_ABS_DATA\n|
      && |  abstract\n|
      && |  create public .\n|
      && |\n|
      && |public section.\n|
      && |\n|
      && |  interfaces /IWBEP/IF_SB_DPC_COMM_SERVICES .\n|.
    IF lv_shlp = abap_true.
      rv_source = rv_source && |  interfaces { zcl_stg_segw_gen_rfc=>gc_shlp_interface } .\n|.
    ENDIF.
    rv_source = rv_source && |  interfaces /IWBEP/IF_SB_GEN_DPC_INJECTION .\n|.
    IF lv_sadl = abap_true.
      rv_source = rv_source
        && |  interfaces IF_SADL_GW_DPC_UTIL .\n|
        && |  interfaces IF_SADL_GW_EXTENSION_CONTROL .\n|
        && |  interfaces IF_SADL_GW_QUERY_CONTROL .\n|.
    ENDIF.
    rv_source = rv_source && |\n|.
* the redefinitions, in SEGW's order Q R U C D
    DO 5 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'Q'.
          lv_name = 'GET_ENTITYSET'.
        WHEN 2.
          lv_kind = 'R'.
          lv_name = 'GET_ENTITY'.
        WHEN 3.
          lv_kind = 'U'.
          lv_name = 'UPDATE_ENTITY'.
        WHEN 4.
          lv_kind = 'C'.
          lv_name = 'CREATE_ENTITY'.
        WHEN 5.
          lv_kind = 'D'.
          lv_name = 'DELETE_ENTITY'.
      ENDCASE.
      READ TABLE lt_kinds WITH KEY table_line = lv_kind TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        APPEND lv_name TO lt_redefs.
      ENDIF.
    ENDDO.
    IF lv_sadl = abap_true.
      APPEND 'CREATE_DEEP_ENTITY' TO lt_redefs.
      APPEND 'EXECUTE_ACTION' TO lt_redefs.
      APPEND 'GET_IS_CONDITIONAL_IMPLEMENTED' TO lt_redefs.
      APPEND 'GET_IS_CONDI_IMPLE_FOR_ACTION' TO lt_redefs.
      APPEND 'PATCH_ENTITY' TO lt_redefs.
    ENDIF.
    LOOP AT lt_redefs INTO lv_name.
      rv_source = rv_source && |  methods /IWBEP/IF_MGW_APPL_SRV_RUNTIME~{ lv_name }\n    redefinition .\n|.
    ENDLOOP.
    rv_source = rv_source
      && |protected section.\n|
      && |\n|
      && |  data mo_injection type ref to /IWBEP/IF_SB_GEN_DPC_INJECTION .\n|
      && |\n|.
    lt_sorted = lt_ops.
    SORT lt_sorted BY sort_key.
    LOOP AT lt_sorted INTO ls_op.
      rv_source = rv_source && |  methods { ls_op-method }\n| && signature( is_op = ls_op is_model = is_model ).
    ENDLOOP.
    rv_source = rv_source
      && |\n|
      && |  methods CHECK_SUBSCRIPTION_AUTHORITY\n|
      && |    redefinition .\n|
      && |private section.\n|
      && |ENDCLASS.\n|
      && |\n\n\n|
      && |CLASS { is_model-dpc } IMPLEMENTATION.\n|
      && |\n|.

* the class editor keeps the implementations in alphabetical order of the
* method name (interface methods sort under their interface)
    DO 5 TIMES.
      CASE sy-index.
        WHEN 1.
          lv_kind = 'C'.
          lv_name = 'CREATE_ENTITY'.
        WHEN 2.
          lv_kind = 'D'.
          lv_name = 'DELETE_ENTITY'.
        WHEN 3.
          lv_kind = 'R'.
          lv_name = 'GET_ENTITY'.
        WHEN 4.
          lv_kind = 'Q'.
          lv_name = 'GET_ENTITYSET'.
        WHEN 5.
          lv_kind = 'U'.
          lv_name = 'UPDATE_ENTITY'.
      ENDCASE.
      READ TABLE lt_kinds WITH KEY table_line = lv_kind TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        ls_impl-name    = |/IWBEP/IF_MGW_APPL_SRV_RUNTIME~{ lv_name }|.
        ls_impl-content = dispatch( iv_kind = lv_kind it_ops = lt_ops is_model = is_model ).
        APPEND ls_impl TO lt_impls.
      ENDIF.
    ENDDO.
    APPEND LINES OF comm_services( ) TO lt_impls.
    IF lv_sadl = abap_true.
      APPEND LINES OF sadl_methods( is_model ) TO lt_impls.
    ENDIF.
    IF lv_shlp = abap_true.
      ls_impl-name    = |{ zcl_stg_segw_gen_rfc=>gc_shlp_interface }~GET_SEARCH_HELP_VALUES|.
      ls_impl-content = zcl_stg_segw_gen_rfc=>shlp_implementation( ).
      APPEND ls_impl TO lt_impls.
    ENDIF.
    LOOP AT lt_sorted INTO ls_op.
      ls_impl-name = ls_op-method.
      IF ls_op-mapping_kind = 'RFC'.
* the module's signature from ZSTG_FM_PARAM; without it (or a parameter
* whose type is unknown) the stub segw-gen writes without a function group
        ls_impl-content = zcl_stg_segw_gen_rfc=>rfc_method( is_op        = ls_op-op
                                                            is_type      = ls_op-entity
                                                            is_model     = is_model
                                                            it_signature = zcl_stg_segw_fugr=>signature( ls_op-function_name ) ).
        IF ls_impl-content IS INITIAL.
          ls_impl-content = stub( iv_method  = ls_op-method
                                  iv_comment = |* Mapped to { ls_op-function_name }: the function group was not available when this class was generated\n| ).
        ENDIF.
      ELSEIF ls_op-mapping_kind = 'SHLP'.
        ls_impl-content = zcl_stg_segw_gen_rfc=>shlp_method( is_op = ls_op-op is_type = ls_op-entity ).
        IF ls_impl-content IS INITIAL.
          ls_impl-content = stub( ls_op-method ).
        ENDIF.
      ELSEIF ls_op-sadl_type = 'ODC'.
        ls_impl-content = odc_method( is_op = ls_op is_model = is_model ).
        IF ls_impl-content IS INITIAL.
          ls_impl-content = stub( ls_op-method ).
        ENDIF.
      ELSEIF ls_op-sadl_type IS NOT INITIAL.
        ls_impl-content = |  method { ls_op-method }.\n{ sadl_delegation( ls_op-type ) }\n  endmethod.\n|.
      ELSE.
        ls_impl-content = stub( ls_op-method ).
      ENDIF.
      APPEND ls_impl TO lt_impls.
    ENDLOOP.
    SORT lt_impls BY name.
    rv_source = rv_source && |\n|.
    lv_first = abap_true.
    LOOP AT lt_impls INTO ls_impl.
      IF lv_first = abap_false.
        rv_source = rv_source && |\n\n|.
      ENDIF.
      lv_first = abap_false.
      rv_source = rv_source && ls_impl-content.
    ENDLOOP.
    rv_source = rv_source && |ENDCLASS.\n|.
  ENDMETHOD.

* ------------------------------------------------------------------ XML

  METHOD clas_xml.
    DATA ls_component TYPE ty_named.
    DATA lv_sub       TYPE string.
    DATA lv_bom       TYPE string.

    lv_bom = zcl_stg_segw_gen=>bom( ).
    rv_xml = |{ lv_bom }<?xml version="1.0" encoding="utf-8"?>\n|
      && |<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">\n|
      && | <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n|
      && |  <asx:values>\n|
      && |   <VSEOCLASS>\n|
      && |    <CLSNAME>{ iv_name }</CLSNAME>\n|
      && |    <LANGU>E</LANGU>\n|
      && |    <DESCRIPT>{ iv_description }</DESCRIPT>\n|
      && |    <STATE>1</STATE>\n|
      && |    <CLSCCINCL>X</CLSCCINCL>\n|
      && |    <FIXPT>X</FIXPT>\n|
      && |    <UNICODE>X</UNICODE>\n|
      && |   </VSEOCLASS>\n|.
    IF it_components IS NOT INITIAL.
      rv_xml = rv_xml && |   <DESCRIPTIONS>\n|.
      LOOP AT it_components INTO ls_component.
        rv_xml = rv_xml
          && |    <SEOCOMPOTX>\n|
          && |     <CMPNAME>{ ls_component-name }</CMPNAME>\n|
          && |     <LANGU>E</LANGU>\n|
          && |     <DESCRIPT>{ ls_component-content }</DESCRIPT>\n|
          && |    </SEOCOMPOTX>\n|.
      ENDLOOP.
      rv_xml = rv_xml && |   </DESCRIPTIONS>\n|.
    ENDIF.
    IF it_subs IS NOT INITIAL.
      rv_xml = rv_xml && |   <DESCRIPTIONS_SUB>\n|.
      LOOP AT it_subs INTO lv_sub.
        rv_xml = rv_xml && lv_sub.
      ENDLOOP.
      rv_xml = rv_xml && |   </DESCRIPTIONS_SUB>\n|.
    ENDIF.
*   The text pool, when the class has one. `LENGTH` is 132 for every entry
*   regardless of the text: it is the width of the pool field, not of the
*   string -- measured across ten real MPC classes, where it is 132 without
*   exception.
    IF it_pool IS NOT INITIAL.
      rv_xml = rv_xml && |   <TPOOL>\n|.
      LOOP AT it_pool INTO ls_component.
        rv_xml = rv_xml
          && |    <item>\n|
          && |     <ID>I</ID>\n|
          && |     <KEY>{ ls_component-name }</KEY>\n|
          && |     <ENTRY>{ xml_text( ls_component-content ) }</ENTRY>\n|
          && |     <LENGTH>132</LENGTH>\n|
          && |    </item>\n|.
      ENDLOOP.
      rv_xml = rv_xml && |   </TPOOL>\n|.
    ENDIF.
    rv_xml = rv_xml
      && |  </asx:values>\n|
      && | </asx:abap>\n|
      && |</abapGit>\n|.
  ENDMETHOD.

  METHOD xml_text.
* A text pool entry is XML, and a label may contain any of the three
* characters that are not. `=/!=/</>/<=/>=` is a real one, out of the search
* corpus, and it made the generated file both different from SEGW's and not
* well-formed -- the second of which no comparison against our own twin
* could have found, because the twin was writing the same invalid file.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
  ENDMETHOD.

  METHOD op_subs.
    DATA ls_sub TYPE ty_named.

    ls_sub-name = '/IWBEP/CX_MGW_BUSI_EXCEPTION'.
    ls_sub-content = 'business exception in mgw'.
    APPEND ls_sub TO rt_subs.
    ls_sub-name = '/IWBEP/CX_MGW_TECH_EXCEPTION'.
    ls_sub-content = 'mgw technical exception'.
    APPEND ls_sub TO rt_subs.
    CASE iv_type.
      WHEN 'C' OR 'U'.
        ls_sub-name = 'ER_ENTITY'.
        ls_sub-content = 'Returning data'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IO_DATA_PROVIDER'.
        ls_sub-content = 'MGW Entry Data Provider'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_KEY_TAB'.
        ls_sub-content = 'table for name value pairs'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_NAVIGATION_PATH'.
        ls_sub-content = 'table of navigation paths'.
        APPEND ls_sub TO rt_subs.
      WHEN 'D'.
        ls_sub-name = 'IT_KEY_TAB'.
        ls_sub-content = 'table for name value pairs'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_NAVIGATION_PATH'.
        ls_sub-content = 'table of navigation paths'.
        APPEND ls_sub TO rt_subs.
      WHEN 'R'.
        ls_sub-name = 'ER_ENTITY'.
        ls_sub-content = 'Returning data'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IO_REQUEST_OBJECT'.
        ls_sub-content = 'table of navigation paths'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_KEY_TAB'.
        ls_sub-content = 'table for name value pairs'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_NAVIGATION_PATH'.
        ls_sub-content = 'table of navigation paths'.
        APPEND ls_sub TO rt_subs.
      WHEN 'Q'.
        ls_sub-name = 'ET_ENTITYSET'.
        ls_sub-content = 'Returning data'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IS_PAGING'.
        ls_sub-content = 'Paging structure'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_FILTER_SELECT_OPTIONS'.
        ls_sub-content = 'Table of select options'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_KEY_TAB'.
        ls_sub-content = 'Table for name value pairs'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_NAVIGATION_PATH'.
        ls_sub-content = 'Table of navigation paths'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IT_ORDER'.
        ls_sub-content = 'The sorting order'.
        APPEND ls_sub TO rt_subs.
        ls_sub-name = 'IV_FILTER_STRING'.
        ls_sub-content = 'Table for name value pairs'.
        APPEND ls_sub TO rt_subs.
    ENDCASE.
  ENDMETHOD.

  METHOD mpc_xml.
    DATA lt_pool   TYPE tt_named.
    DATA ls_pool   TYPE ty_named.
    DATA ls_type_p TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_prop_p TYPE zcl_stg_segw_gen=>ty_property.
    DATA ls_fi_p   TYPE zcl_stg_segw_gen=>ty_function_import.
    DATA ls_fp_p   TYPE zcl_stg_segw_gen=>ty_parameter.
    DATA lt_names TYPE string_table.
    DATA lv_name  TYPE string.
    DATA ls_type  TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA lt_comp  TYPE tt_named.
    DATA ls_comp  TYPE ty_named.

    IF is_model-complex_types IS NOT INITIAL.
      APPEND 'DEFINE_COMPLEXTYPES' TO lt_names.
    ENDIF.
    LOOP AT is_model-entity_types INTO ls_type.
      APPEND |DEFINE_{ ls_type-define_stem }| TO lt_names.
    ENDLOOP.
    IF is_model-associations IS NOT INITIAL OR is_model-navigation IS NOT INITIAL.
      APPEND 'DEFINE_ASSOCIATIONS' TO lt_names.
    ENDIF.
    IF is_model-function_imports IS NOT INITIAL.
      APPEND 'DEFINE_ACTIONS' TO lt_names.
    ENDIF.
    APPEND 'LOAD_TEXT_ELEMENTS' TO lt_names.
    SORT lt_names.
    LOOP AT lt_names INTO lv_name.
      ls_comp-name    = lv_name.
      ls_comp-content = lv_name.
      APPEND ls_comp TO lt_comp.
    ENDLOOP.
*   Three groups in a row, not one walk: every property, then every action,
*   then every action's parameters. That is why a two-action model pools its
*   symbols 016, 018, 017, 019 -- the numbering follows the model and the
*   pool follows the groups, and the two orders are not the same. Reading it
*   as one traversal produces a file that is right about every entry and
*   wrong about their order.
    LOOP AT is_model-entity_types INTO ls_type_p.
      LOOP AT ls_type_p-properties INTO ls_prop_p.
        IF ls_prop_p-text_element IS INITIAL.
          CONTINUE.
        ENDIF.
        CLEAR ls_pool.
        ls_pool-name    = ls_prop_p-text_element.
        ls_pool-content = ls_prop_p-label.
        APPEND ls_pool TO lt_pool.
      ENDLOOP.
    ENDLOOP.
    LOOP AT is_model-function_imports INTO ls_fi_p.
      IF ls_fi_p-text_element IS INITIAL.
        CONTINUE.
      ENDIF.
      CLEAR ls_pool.
      ls_pool-name    = ls_fi_p-text_element.
      ls_pool-content = ls_fi_p-name.
      APPEND ls_pool TO lt_pool.
    ENDLOOP.
    LOOP AT is_model-function_imports INTO ls_fi_p.
      LOOP AT ls_fi_p-parameters INTO ls_fp_p.
        IF ls_fp_p-text_element IS INITIAL.
          CONTINUE.
        ENDIF.
        CLEAR ls_pool.
        ls_pool-name    = ls_fp_p-text_element.
        ls_pool-content = ls_fp_p-name.
        APPEND ls_pool TO lt_pool.
      ENDLOOP.
    ENDLOOP.
    rv_xml = clas_xml( iv_name        = is_model-mpc
                       iv_description = is_model-mpc
                       it_components  = lt_comp
                       it_pool        = lt_pool ).
  ENDMETHOD.

  METHOD dpc_xml.
    DATA lt_ops  TYPE tt_op.
    DATA ls_op   TYPE ty_op.
    DATA lt_comp TYPE tt_named.
    DATA ls_comp TYPE ty_named.
    DATA lt_subs TYPE string_table.
    DATA lt_sub  TYPE tt_named.
    DATA ls_sub  TYPE ty_named.

    lt_ops = operations( is_model ).
    SORT lt_ops BY sort_key.
    LOOP AT lt_ops INTO ls_op.
      ls_comp-name    = ls_op-method.
      ls_comp-content = |Related EntitySet Name: { ls_op-set_name }|.
      APPEND ls_comp TO lt_comp.
      lt_sub = op_subs( ls_op-type ).
      LOOP AT lt_sub INTO ls_sub.
        APPEND |    <SEOSUBCOTX>\n|
          && |     <CMPNAME>{ ls_op-method }</CMPNAME>\n|
          && |     <SCONAME>{ ls_sub-name }</SCONAME>\n|
          && |     <LANGU>E</LANGU>\n|
          && |     <DESCRIPT>{ ls_sub-content }</DESCRIPT>\n|
          && |    </SEOSUBCOTX>\n| TO lt_subs.
      ENDLOOP.
    ENDLOOP.
    rv_xml = clas_xml( iv_name        = is_model-dpc
                       iv_description = 'Data Provider Base Class'
                       it_components  = lt_comp
                       it_subs        = lt_subs ).
  ENDMETHOD.

  METHOD ext_sources.
    DATA ls_file TYPE zcl_stg_segw_gen=>ty_file.

    IF is_model-mpc_ext IS NOT INITIAL.
      ls_file-name    = zcl_stg_segw_gen=>file_name( iv_class = is_model-mpc_ext iv_ext = '.clas.abap' ).
      ls_file-content = |class { is_model-mpc_ext } definition\n|
        && |  public\n|
        && |  inheriting from { is_model-mpc }\n|
        && |  create public .\n|
        && |\n|
        && |public section.\n|
        && |protected section.\n|
        && |private section.\n|
        && |ENDCLASS.\n|
        && |\n\n\n|
        && |CLASS { is_model-mpc_ext } IMPLEMENTATION.\n|
        && |ENDCLASS.\n|.
      APPEND ls_file TO rt_files.
      ls_file-name    = zcl_stg_segw_gen=>file_name( iv_class = is_model-mpc_ext iv_ext = '.clas.xml' ).
      ls_file-content = clas_xml( iv_name = is_model-mpc_ext iv_description = is_model-mpc_ext ).
      APPEND ls_file TO rt_files.
    ENDIF.
    IF is_model-dpc_ext IS NOT INITIAL.
      ls_file-name    = zcl_stg_segw_gen=>file_name( iv_class = is_model-dpc_ext iv_ext = '.clas.abap' ).
      ls_file-content = |class { is_model-dpc_ext } definition\n|
        && |  public\n|
        && |  inheriting from { is_model-dpc }\n|
        && |  create public .\n|
        && |\n|
        && |public section.\n|
        && |protected section.\n|
        && |private section.\n|
        && |ENDCLASS.\n|
        && |\n\n\n|
        && |CLASS { is_model-dpc_ext } IMPLEMENTATION.\n|
        && |ENDCLASS.\n|.
      APPEND ls_file TO rt_files.
      ls_file-name    = zcl_stg_segw_gen=>file_name( iv_class = is_model-dpc_ext iv_ext = '.clas.xml' ).
      ls_file-content = clas_xml( iv_name = is_model-dpc_ext iv_description = 'Data Provider Secondary Class' ).
      APPEND ls_file TO rt_files.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
