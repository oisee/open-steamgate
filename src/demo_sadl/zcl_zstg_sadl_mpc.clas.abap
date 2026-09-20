CLASS zcl_zstg_sadl_mpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_model CREATE PUBLIC.
* A reference-data-source (SADL) model provider in the shape SEGW generates,
* written in 7.02 syntax. The model comes from the SADL definition and the
* CDS views; there is no hand-written entity type here.
  PUBLIC SECTION.
    INTERFACES if_sadl_gw_model_exposure_data.

    METHODS define REDEFINITION.
    METHODS get_last_modified REDEFINITION.
  PROTECTED SECTION.
  PRIVATE SECTION.
    METHODS define_rds_1
      RAISING
        /iwbep/cx_mgw_med_exception.

    METHODS get_last_modified_rds_1
      RETURNING
        VALUE(rv_last_modified_rds) TYPE timestamp.
ENDCLASS.

CLASS zcl_zstg_sadl_mpc IMPLEMENTATION.

  METHOD define.
    model->set_schema_namespace( 'ZSTG_SADL_SRV' ).
    define_rds_1( ).
    get_last_modified_rds_1( ).
  ENDMETHOD.

  METHOD define_rds_1.
    DATA lx_sadl_exposure_error TYPE REF TO cx_sadl_exposure_error.

    TRY.
        if_sadl_gw_model_exposure_data~get_model_exposure( )->expose( model )->expose_vocabulary( vocab_anno_model ).
      CATCH cx_sadl_exposure_error INTO lx_sadl_exposure_error.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_med_exception
          EXPORTING
            previous = lx_sadl_exposure_error.
    ENDTRY.
  ENDMETHOD.

  METHOD get_last_modified.
    CONSTANTS lc_gen_date_time TYPE timestamp VALUE '20260912010000'.
    rv_last_modified = super->get_last_modified( ).
    IF rv_last_modified < lc_gen_date_time.
      rv_last_modified = lc_gen_date_time.
    ENDIF.
  ENDMETHOD.

  METHOD get_last_modified_rds_1.
    CONSTANTS co_gen_date_time TYPE timestamp VALUE '20260912010000'.
    DATA lo_exposure TYPE REF TO cl_sadl_gw_model_exposure.

    TRY.
        lo_exposure ?= if_sadl_gw_model_exposure_data~get_model_exposure( ).
        rv_last_modified_rds = lo_exposure->get_last_modified( ).
      CATCH cx_root.
        rv_last_modified_rds = co_gen_date_time.
    ENDTRY.
    IF rv_last_modified_rds < co_gen_date_time.
      rv_last_modified_rds = co_gen_date_time.
    ENDIF.
  ENDMETHOD.

  METHOD if_sadl_gw_model_exposure_data~get_model_exposure.
    DATA lv_sadl_xml TYPE string.

    lv_sadl_xml =
      |<?xml version="1.0" encoding="utf-16"?>| &&
      |<sadl:definition xmlns:sadl="http://sap.com/sap.nw.f.sadl" syntaxVersion="" >| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_TRAVEL" binding="ZC_STG_TRAVEL" />| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_BOOKING" binding="ZC_STG_BOOKING" />| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_TRAVELCUBE" binding="ZC_STG_TRAVELCUBE" />| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_FLIGHTCUBE" binding="ZC_STG_FLIGHTCUBE" />| &&
      | <sadl:dataSource type="CDS" name="ZC_OSD_TAXICUBE" binding="ZC_OSD_TAXICUBE" />| &&
      |<sadl:resultSet>| &&
      |<sadl:structure name="Zc_Stg_Travel" dataSource="ZC_STG_TRAVEL" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      | <sadl:association name="TO_BOOKINGS" binding="_BOOKINGS" target="Zc_Stg_Booking" cardinality="many" />| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Stg_Booking" dataSource="ZC_STG_BOOKING" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      | <sadl:association name="TO_TRAVEL" binding="_TRAVEL" target="Zc_Stg_Travel" cardinality="zeroToOne" />| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Stg_Travelcube" dataSource="ZC_STG_TRAVELCUBE" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Stg_Flightcube" dataSource="ZC_STG_FLIGHTCUBE" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Osd_Taxicube" dataSource="ZC_OSD_TAXICUBE" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      |</sadl:structure>| &&
      |</sadl:resultSet>| &&
      |</sadl:definition>|.

    ro_model_exposure = cl_sadl_gw_model_exposure=>get_exposure_xml( iv_uuid      = 'ZSTG_SADL'
                                                                     iv_timestamp = '20260912010000'
                                                                     iv_sadl_xml  = lv_sadl_xml ).
  ENDMETHOD.

ENDCLASS.
