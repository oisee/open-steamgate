CLASS zcl_zstg_demo_mpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_model CREATE PUBLIC.
* Hand-written in the shape SEGW generates. Clean-room: no SAP source.
  PUBLIC SECTION.
    TYPES: BEGIN OF ts_travel,
             travel_id   TYPE c LENGTH 8,
             description TYPE c LENGTH 40,
             status      TYPE c LENGTH 1,
             seats       TYPE i,
           END OF ts_travel.
    TYPES tt_travel TYPE STANDARD TABLE OF ts_travel WITH DEFAULT KEY.

    CONSTANTS gc_travel TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name VALUE 'Travel' ##NO_TEXT.
    CONSTANTS gc_travel_set TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name VALUE 'TravelSet' ##NO_TEXT.

    METHODS define REDEFINITION.
  PROTECTED SECTION.
  PRIVATE SECTION.
    METHODS define_travel
      RAISING
        /iwbep/cx_mgw_med_exception.
ENDCLASS.

CLASS zcl_zstg_demo_mpc IMPLEMENTATION.

  METHOD define.
    model->set_schema_namespace( 'ZSTG_DEMO_SRV' ).
    define_travel( ).
  ENDMETHOD.

  METHOD define_travel.
    DATA lo_entity_type TYPE REF TO /iwbep/if_mgw_odata_entity_typ.
    DATA lo_property    TYPE REF TO /iwbep/if_mgw_odata_property.
    DATA lo_entity_set  TYPE REF TO /iwbep/if_mgw_odata_entity_set.

    lo_entity_type = model->create_entity_type( iv_entity_type_name = gc_travel
                                                iv_def_entity_set   = abap_false ).

    lo_property = lo_entity_type->create_property( iv_property_name  = 'TravelId'
                                                   iv_abap_fieldname = 'TRAVEL_ID' ).
    lo_property->set_is_key( ).
    lo_property->set_type_edm_string( ).
    lo_property->set_maxlength( 8 ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_false ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_false ).
    lo_property->set_filterable( abap_true ).

    lo_property = lo_entity_type->create_property( iv_property_name  = 'Description'
                                                   iv_abap_fieldname = 'DESCRIPTION' ).
    lo_property->set_type_edm_string( ).
    lo_property->set_maxlength( 40 ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).

    lo_property = lo_entity_type->create_property( iv_property_name  = 'Status'
                                                   iv_abap_fieldname = 'STATUS' ).
    lo_property->set_type_edm_string( ).
    lo_property->set_maxlength( 1 ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).

* Seats is Edm.Int32 on a real system. set_type_edm_int32 is a todo-assert in
* open-abap-odata today (QW5); typed as string until that lands.
    lo_property = lo_entity_type->create_property( iv_property_name  = 'Seats'
                                                   iv_abap_fieldname = 'SEATS' ).
    lo_property->set_type_edm_string( ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).

    lo_entity_type->bind_structure( iv_structure_name   = 'ZCL_ZSTG_DEMO_MPC=>TS_TRAVEL'
                                    iv_bind_conversions = abap_true ).

    lo_entity_set = lo_entity_type->create_entity_set( gc_travel_set ).
    lo_entity_set->set_creatable( abap_true ).
    lo_entity_set->set_updatable( abap_true ).
    lo_entity_set->set_deletable( abap_true ).
    lo_entity_set->set_pageable( abap_true ).
    lo_entity_set->set_addressable( abap_true ).
    lo_entity_set->set_has_ftxt_search( abap_false ).
    lo_entity_set->set_subscribable( abap_false ).
    lo_entity_set->set_filter_required( abap_false ).
  ENDMETHOD.

ENDCLASS.
