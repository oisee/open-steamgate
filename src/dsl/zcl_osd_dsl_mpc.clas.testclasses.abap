CLASS ltcl_dsl_mpc DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS seeded_project FOR TESTING RAISING cx_static_check.
    METHODS imported_project FOR TESTING RAISING cx_static_check.
    METHODS compare_project IMPORTING iv_project TYPE string RAISING cx_static_check.
    METHODS fixture RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.

CLASS ltcl_dsl_mpc IMPLEMENTATION.
  METHOD fixture.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = zcl_stg_segw_gen=>bom( )
      && `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWPR" serializer_version="v1.0.0">` && lv_nl
      && ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>` && lv_nl
      && `<_-IWBEP_-I_SBD_GA><_-IWBEP_-I_SBD_GA><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>ga-1</NODE_UUID><NAME>ZCL_ZUT_DSL_MPC</NAME><GEN_ART_TYPE>MPCB</GEN_ART_TYPE></_-IWBEP_-I_SBD_GA></_-IWBEP_-I_SBD_GA>` && lv_nl
      && `<_-IWBEP_-I_SBD_PR><_-IWBEP_-I_SBD_PR><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>pr-1</NODE_UUID><PROJECT_TYPE>1</PROJECT_TYPE></_-IWBEP_-I_SBD_PR></_-IWBEP_-I_SBD_PR>` && lv_nl
      && `<_-IWBEP_-I_SBO_ET>` && lv_nl
      && `<_-IWBEP_-I_SBO_ET><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>et-1</NODE_UUID><NAME>Travel</NAME><ABAP_STRUCT>ZSTG_DEMO</ABAP_STRUCT></_-IWBEP_-I_SBO_ET>` && lv_nl
      && `<_-IWBEP_-I_SBO_ET><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>et-2</NODE_UUID><NAME>Media</NAME><IS_MEDIA>X</IS_MEDIA></_-IWBEP_-I_SBO_ET>` && lv_nl
      && `<_-IWBEP_-I_SBO_ET><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>et-3</NODE_UUID><NAME>Empty</NAME></_-IWBEP_-I_SBO_ET>` && lv_nl
      && `</_-IWBEP_-I_SBO_ET>` && lv_nl
      && `<_-IWBEP_-I_SBO_CT><_-IWBEP_-I_SBO_CT><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>ct-1</NODE_UUID><NAME>Address</NAME></_-IWBEP_-I_SBO_CT></_-IWBEP_-I_SBO_CT>` && lv_nl
      && `<_-IWBEP_-I_SBO_PR>` && lv_nl
      && `<_-IWBEP_-I_SBO_PR><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>pp-1</NODE_UUID><PARENT_UUID>et-1</PARENT_UUID><NAME>TravelId</NAME><IS_KEY>X</IS_KEY><EDM_CORE_TYPE>Edm.String</EDM_CORE_TYPE><PROP_PRECISION>2</PROP_PRECISION><MAX_LENGTH>20</MAX_LENGTH><AS_ETAG>X</AS_ETAG></_-IWBEP_-I_SBO_PR>` && lv_nl
      && `<_-IWBEP_-I_SBO_PR><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>pp-2</NODE_UUID><PARENT_UUID>et-1</PARENT_UUID><NAME>Address</NAME><COMPLEX_TYPE>ct-1</COMPLEX_TYPE></_-IWBEP_-I_SBO_PR>` && lv_nl
      && `</_-IWBEP_-I_SBO_PR>` && lv_nl
      && `<_-IWBEP_-I_SBO_PRT><_-IWBEP_-I_SBO_PRT><PROJECT>ZUT_DSL</PROJECT><SYLANGU>E</SYLANGU><NODE_UUID>pp-1</NODE_UUID><PROP_LABEL>Travel</PROP_LABEL></_-IWBEP_-I_SBO_PRT></_-IWBEP_-I_SBO_PRT>` && lv_nl
      && `<_-IWBEP_-I_SBO_ES>` && lv_nl
      && `<_-IWBEP_-I_SBO_ES><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>es-1</NODE_UUID><NAME>TravelSet</NAME><ENTITY_TYPE>et-1</ENTITY_TYPE><CREATABLE>X</CREATABLE></_-IWBEP_-I_SBO_ES>` && lv_nl
      && `<_-IWBEP_-I_SBO_ES><PROJECT>ZUT_DSL</PROJECT><NODE_UUID>es-2</NODE_UUID><NAME>TravelAltSet</NAME><ENTITY_TYPE>et-1</ENTITY_TYPE></_-IWBEP_-I_SBO_ES>` && lv_nl
      && `</_-IWBEP_-I_SBO_ES>` && lv_nl
      && `</asx:values></asx:abap></abapGit>` && lv_nl.
  ENDMETHOD.

  METHOD imported_project.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    zcl_oao_registry=>register( iv_service = 'ZSTG_SEGW_SRV'
                                iv_mpc = 'ZCL_ZSTG_SEGW_MPC_EXT'
                                iv_dpc = 'ZCL_ZSTG_SEGW_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
    ls_response = zcl_stg_dispatcher=>dispatch(
      iv_method = 'POST'
      iv_path = '/sap/opu/odata/sap/ZSTG_SEGW_SRV/ImportSet'
      iv_body = `{"Content":"` && zcl_stg_json=>escape( fixture( ) ) && `"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 201 msg = ls_response-body ).
    compare_project( 'ZUT_DSL' ).
  ENDMETHOD.

  METHOD seeded_project.
    DATA ls_model TYPE zcl_stg_segw_gen=>ty_model.
    ls_model = zcl_stg_segw_gen=>build_model( 'ZSTG_MAPPED' ).
    IF ls_model-entity_types IS NOT INITIAL.
      compare_project( 'ZSTG_MAPPED' ).
    ENDIF.
  ENDMETHOD.

  METHOD compare_project.
    DATA ls_model TYPE zcl_stg_segw_gen=>ty_model.
    DATA ls_type TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lv_source TYPE string.
    DATA lv_expected TYPE string.
    DATA lv_actual TYPE string.
    DATA lv_start TYPE i.
    DATA lv_end TYPE i.
    DATA lv_length TYPE i.
    DATA lv_count TYPE i.
    DATA lo_json TYPE REF TO zif_ajson.
    DATA lv_path TYPE string.
    DATA lv_node TYPE string.
    DATA lv_pos TYPE i.
    ls_model = zcl_stg_segw_gen=>build_model( iv_project ).
    lv_source = zcl_stg_segw_gen=>mpc_source( ls_model ).
    IF iv_project = 'ZUT_DSL'.
      cl_abap_unit_assert=>assert_equals( act = lines( ls_model-entity_types ) exp = 3 ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `set_is_media( 'X' )` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `create_complex_property(` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `set_is_key( )` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `set_label_from_text_element(` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `set_precison(` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `set_maxlength(` ) ).
      cl_abap_unit_assert=>assert_true( xsdbool( lv_source CS `TravelAltSet` ) ).
    ENDIF.
    LOOP AT ls_model-entity_types INTO ls_type.
      lv_count = lv_count + 1.
      FIND `  method DEFINE_` && ls_type-define_stem && `.` IN lv_source MATCH OFFSET lv_start.
      cl_abap_unit_assert=>assert_subrc( ).
      FIND `  endmethod.` IN SECTION OFFSET lv_start OF lv_source MATCH OFFSET lv_end.
      cl_abap_unit_assert=>assert_subrc( ).
      lv_length = lv_end - lv_start + strlen( `  endmethod.` ) + 1.
      lv_expected = substring( val = lv_source off = lv_start len = lv_length ).
      ls_result = zcl_osd_dsl_mpc=>render_entity( is_type = ls_type iv_mpc = ls_model-mpc ).
      lv_actual = zcl_osd_tpl=>to_string( ls_result ).
      cl_abap_unit_assert=>assert_equals( act = lv_actual exp = lv_expected msg = ls_type-name ).
      cl_abap_unit_assert=>assert_equals( act = lines( ls_result-trace ) exp = lines( ls_result-lines ) ).
      lo_json = zcl_osd_dsl_mpc=>entity_model( is_type = ls_type iv_mpc = ls_model-mpc ).
      LOOP AT ls_result-trace INTO ls_trace.
        lv_path = ls_trace-path.
        CLEAR lv_node.
        WHILE lv_node IS INITIAL.
          IF lv_path = `/`.
            lv_node = lo_json->get( `/@id` ).
            EXIT.
          ENDIF.
          lv_node = lo_json->get( lv_path && `/@id` ).
          IF lv_node IS INITIAL.
            FIND REGEX `/[^/]+$` IN lv_path MATCH OFFSET lv_pos.
            IF sy-subrc <> 0.
              lv_path = `/`.
            ELSE.
              lv_path = substring( val = lv_path len = lv_pos ).
              IF lv_path IS INITIAL.
                lv_path = `/`.
              ENDIF.
            ENDIF.
          ENDIF.
        ENDWHILE.
        cl_abap_unit_assert=>assert_true( xsdbool( lv_node CP `entity/*` ) ).
      ENDLOOP.
    ENDLOOP.
    cl_abap_unit_assert=>assert_true( xsdbool( lv_count > 0 ) ).
  ENDMETHOD.
ENDCLASS.
