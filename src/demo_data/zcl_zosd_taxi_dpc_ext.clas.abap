* ZOSD_TAXI_SRV: the taxi demo's sample data (src/demo_data/zosd_taxi.stg.yaml).
* Every call is handed to ZCL_OSD_DEMO_DATA, which owns the rows; this class
* only turns its answers into the service's shapes. A request is one dialog
* step on every host, so a generate or a reset commits when it returns and
* rolls back whole if it dumps.
CLASS zcl_zosd_taxi_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zosd_taxi_dpc CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.

  PROTECTED SECTION.
    METHODS yearset_get_entityset REDEFINITION.

  PRIVATE SECTION.
    METHODS key_value
      IMPORTING
        it_key_tab      TYPE /iwbep/t_mgw_name_value_pair
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.
ENDCLASS.



CLASS zcl_zosd_taxi_dpc_ext IMPLEMENTATION.

  METHOD yearset_get_entityset.
    DATA lt_years TYPE zcl_osd_demo_data=>ty_years.
    DATA ls_year TYPE zcl_osd_demo_data=>ty_year.
    DATA ls_entity TYPE zcl_zosd_taxi_mpc=>ts_year.
    lt_years = zcl_osd_demo_data=>years( ).
    LOOP AT lt_years INTO ls_year.
      CLEAR ls_entity.
      ls_entity-year = ls_year-year.
      ls_entity-rows = ls_year-rows.
      ls_entity-trips = ls_year-trips.
      ls_entity-profile = zcl_osd_demo_taxi=>profile( ls_year-year ).
      APPEND ls_entity TO et_entityset.
    ENDLOOP.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    DATA lv_text TYPE string.
    DATA lv_year TYPE i.
    DATA lv_report TYPE string.
    CASE iv_action_name.
      WHEN 'GenerateYear'.
        lv_text = key_value( it_key_tab = it_parameter
                             iv_name    = 'Year' ).
        CONDENSE lv_text.
        IF lv_text IS INITIAL OR lv_text CN '0123456789'.
          RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
            EXPORTING
              message = |Year "{ lv_text }" is not a year|.
        ENDIF.
        lv_year = lv_text.
        lv_report = zcl_osd_demo_data=>generate_year( lv_year ).
      WHEN 'ResetData'.
        lv_report = zcl_osd_demo_data=>reset( ).
      WHEN OTHERS.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
          EXPORTING
            textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
            method = iv_action_name.
    ENDCASE.
    copy_data_to_ref( EXPORTING is_data = lv_report
                      CHANGING  cr_data = er_data ).
  ENDMETHOD.

  METHOD key_value.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.
    READ TABLE it_key_tab INTO ls_key WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_key-value.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
