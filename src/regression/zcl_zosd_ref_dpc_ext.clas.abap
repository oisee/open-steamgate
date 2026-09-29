CLASS zcl_zosd_ref_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zosd_ref_dpc
  CREATE PUBLIC .

  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS clockset_get_entity REDEFINITION.
    METHODS clockset_get_entityset REDEFINITION.
  PRIVATE SECTION.
    METHODS observe RETURNING VALUE(rs_clock) TYPE zcl_zosd_ref_mpc=>ts_clock.
ENDCLASS.



CLASS ZCL_ZOSD_REF_DPC_EXT IMPLEMENTATION.
  METHOD observe.
    rs_clock-id = 'CLOCK'.
    rs_clock-observed_at = |{ sy-datum DATE = ISO }T{ sy-uzeit TIME = ISO }Z|.
    TRY.
        rs_clock-token = cl_system_uuid=>create_uuid_c36_static( ).
      CATCH cx_uuid_error.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception.
    ENDTRY.
  ENDMETHOD.

  METHOD clockset_get_entity.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.
    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'Id'.
    IF sy-subrc <> 0 OR ls_key-value <> 'CLOCK'.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Clock not found'.
    ENDIF.
    er_entity = observe( ).
  ENDMETHOD.

  METHOD clockset_get_entityset.
    APPEND observe( ) TO et_entityset.
  ENDMETHOD.
ENDCLASS.
