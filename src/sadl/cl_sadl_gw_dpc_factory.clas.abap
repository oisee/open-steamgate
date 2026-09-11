CLASS cl_sadl_gw_dpc_factory DEFINITION PUBLIC CREATE PUBLIC.
* Clean-room factory a generated reference-data-source DPC calls from
* if_sadl_gw_dpc_util~get_dpc.
  PUBLIC SECTION.
    CLASS-METHODS create_for_sadl
      IMPORTING
        iv_sadl_xml   TYPE string
        iv_timestamp  TYPE timestamp OPTIONAL
        iv_uuid       TYPE string OPTIONAL
        io_context    TYPE REF TO /iwbep/if_mgw_context OPTIONAL
      RETURNING
        VALUE(ro_dpc) TYPE REF TO if_sadl_gw_dpc
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.
ENDCLASS.

CLASS cl_sadl_gw_dpc_factory IMPLEMENTATION.

  METHOD create_for_sadl.
    DATA lo_dpc TYPE REF TO zcl_stg_sadl_dpc.

    CREATE OBJECT lo_dpc
      EXPORTING
        iv_sadl_xml = iv_sadl_xml.
    ro_dpc = lo_dpc.
  ENDMETHOD.

ENDCLASS.
