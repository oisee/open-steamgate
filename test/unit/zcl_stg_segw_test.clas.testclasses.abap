* The SEGW project tree served from its own tables through a service that
* is nothing but YAML (src/segw/zstg_segw.stg.yaml -> stg-compile -> classes
* that delegate to SADL): create, read, update, delete over a DDIC table
* without a line of hand-written DPC code
CLASS ltcl_crud DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    CONSTANTS gc_base TYPE string VALUE '/sap/opu/odata/sap/ZSTG_SEGW_SRV'.
    METHODS setup.
    METHODS create_read_update_delete FOR TESTING RAISING cx_static_check.
    METHODS create_duplicate_is_400 FOR TESTING RAISING cx_static_check.
    METHODS create_without_key_is_400 FOR TESTING RAISING cx_static_check.
    METHODS delete_unknown_is_400 FOR TESTING RAISING cx_static_check.
    METHODS text_table_with_language_key FOR TESTING RAISING cx_static_check.
    METHODS call
      IMPORTING
        iv_method          TYPE string
        iv_path            TYPE string
        iv_body            TYPE string OPTIONAL
        iv_query           TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.
ENDCLASS.

CLASS ltcl_crud IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_SEGW_SRV'
                                iv_mpc     = 'ZCL_ZSTG_SEGW_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_SEGW_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
    DELETE FROM zstg_sbd_pr WHERE project LIKE 'ZUT_%'.
    DELETE FROM zstg_sbd_prt WHERE project LIKE 'ZUT_%'.
  ENDMETHOD.

  METHOD call.
    DATA lt_options TYPE tihttpnvp.

    IF iv_query IS NOT INITIAL.
      lt_options = cl_http_utility=>string_to_fields( iv_query ).
    ENDIF.
    rs_response = zcl_stg_dispatcher=>dispatch( iv_method  = iv_method
                                                iv_path    = iv_path
                                                it_options = lt_options
                                                iv_body    = iv_body ).
  ENDMETHOD.

  METHOD create_read_update_delete.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = gc_base && '/ProjectSet'
                        iv_body   = `{"Project":"ZUT_ONE","NodeUuid":"pr-1","ProjectType":"S","LastChgTime":"20260912200000.0000000"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 201 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"Project":"ZUT_ONE"` ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"ProjectType":"S"` ) ).

    ls_response = call( iv_method = 'GET'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_ONE',NodeUuid='pr-1')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"NodeUuid":"pr-1"` ) ).

    ls_response = call( iv_method = 'PUT'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_ONE',NodeUuid='pr-1')`
                        iv_body   = `{"Project":"ZUT_ONE","NodeUuid":"pr-1","ProjectType":"R"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 204 ).
    ls_response = call( iv_method = 'GET'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_ONE',NodeUuid='pr-1')` ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"ProjectType":"R"` ) ).

* the set lists it, $filter on a key works through the generic read
    ls_response = call( iv_method = 'GET'
                        iv_path   = gc_base && `/ProjectSet`
                        iv_query  = `$filter=Project eq 'ZUT_ONE'` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"ProjectType":"R"` ) ).

    ls_response = call( iv_method = 'DELETE'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_ONE',NodeUuid='pr-1')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 204 ).
    ls_response = call( iv_method = 'GET'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_ONE',NodeUuid='pr-1')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
  ENDMETHOD.

  METHOD create_duplicate_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = gc_base && '/ProjectSet'
                        iv_body   = `{"Project":"ZUT_DUP","NodeUuid":"pr-1"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 201 ).
    ls_response = call( iv_method = 'POST'
                        iv_path   = gc_base && '/ProjectSet'
                        iv_body   = `{"Project":"ZUT_DUP","NodeUuid":"pr-1"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
  ENDMETHOD.

  METHOD create_without_key_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = gc_base && '/ProjectSet'
                        iv_body   = `{"Project":"ZUT_NOKEY","ProjectType":"S"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `NODE_UUID` ) ).
  ENDMETHOD.

  METHOD delete_unknown_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'DELETE'
                        iv_path   = gc_base && `/ProjectSet(Project='ZUT_NONE',NodeUuid='x')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
  ENDMETHOD.

  METHOD text_table_with_language_key.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = gc_base && '/ProjectTextSet'
                        iv_body   = `{"Project":"ZUT_TXT","Language":"E","Description":"A project, described"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 201 ).
    ls_response = call( iv_method = 'GET'
                        iv_path   = gc_base && `/ProjectTextSet(Project='ZUT_TXT',Language='E')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"Description":"A project, described"` ) ).
  ENDMETHOD.

ENDCLASS.

* the project tree imported from test/fixtures/segw/zstg_mapped.iwpr.xml
* (data/zstg_sb*.tabu.json, tools/segw-tree.mjs) is served by the same service
CLASS ltcl_tree DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS entity_types_of_the_project FOR TESTING.
    METHODS properties_in_file_order FOR TESTING.
    METHODS text_table_of_the_project FOR TESTING.
ENDCLASS.

CLASS ltcl_tree IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_SEGW_SRV'
                                iv_mpc     = 'ZCL_ZSTG_SEGW_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_SEGW_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD entity_types_of_the_project.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lt_options TYPE tihttpnvp.

    lt_options = cl_http_utility=>string_to_fields( `$filter=Project eq 'ZSTG_MAPPED'&$orderby=StgSeq` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_SEGW_SRV/EntityTypeSet'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 msg = ls_response-body ).
    cl_abap_unit_assert=>assert_true( xsdbool( ls_response-body CS '"Name":"Travel"' ) ).
    cl_abap_unit_assert=>assert_true( xsdbool( ls_response-body CS '"Name":"StatusVH"' ) ).
    cl_abap_unit_assert=>assert_true( xsdbool( ls_response-body CS '"AbapStruct":"ZSTG_DEMO"' ) ).
  ENDMETHOD.

  METHOD properties_in_file_order.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lt_options TYPE tihttpnvp.
    DATA lv_travel TYPE i.
    DATA lv_seats  TYPE i.

    lt_options = cl_http_utility=>string_to_fields( `$filter=Project eq 'ZSTG_MAPPED' and ParentUuid eq 'et-1'&$orderby=StgSeq&$select=Name,StgSeq` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_SEGW_SRV/PropertySet'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 msg = ls_response-body ).
    FIND '"Name":"TravelId"' IN ls_response-body MATCH OFFSET lv_travel.
    cl_abap_unit_assert=>assert_subrc( msg = ls_response-body ).
    FIND '"Name":"Seats"' IN ls_response-body MATCH OFFSET lv_seats.
    cl_abap_unit_assert=>assert_subrc( msg = ls_response-body ).
    cl_abap_unit_assert=>assert_true( xsdbool( lv_travel < lv_seats ) ).
    cl_abap_unit_assert=>assert_false( xsdbool( ls_response-body CS '"Name":"Status"' ) ).
  ENDMETHOD.

  METHOD text_table_of_the_project.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'
                                                iv_path   = `/sap/opu/odata/sap/ZSTG_SEGW_SRV/ProjectTextSet(Project='ZSTG_MAPPED',Language='E')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 msg = ls_response-body ).
    cl_abap_unit_assert=>assert_true( xsdbool( ls_response-body CS '"Description":"' ) ).
  ENDMETHOD.

ENDCLASS.
