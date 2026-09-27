* HAND-HELD COPY of what stg-compile generates from zosd_taxi.stg.yaml, less
* the labels of the two actions and their parameter. open-abap-odata's
* /IWBEP/IF_MGW_ODATA_ACTION (and _PARAMETER) has no
* SET_LABEL_FROM_TEXT_ELEMENT, which SEGW writes for every action on a system
* (ANORMALIES: ANOMALY-2026-09-27-action-label). Kept in src/ so that
* stg-compile --all leaves it alone; regenerate and drop this copy when the
* interface has the method.
CLASS zcl_zosd_taxi_mpc DEFINITION
  PUBLIC
  INHERITING FROM /iwbep/cl_mgw_push_abs_model
  CREATE PUBLIC .

  PUBLIC SECTION.

    TYPES:
    BEGIN OF ts_generateyear,
        year TYPE i,
    END OF ts_generateyear .
    TYPES:
   BEGIN OF ts_text_element,
      artifact_name  TYPE c LENGTH 40,       " technical name
      artifact_type  TYPE c LENGTH 4,
      parent_artifact_name TYPE c LENGTH 40, " technical name
      parent_artifact_type TYPE c LENGTH 4,
      text_symbol    TYPE textpoolky,
   END OF ts_text_element .
    TYPES:
         tt_text_elements TYPE STANDARD TABLE OF ts_text_element WITH KEY text_symbol .
    TYPES:
      BEGIN OF ts_year,
     year TYPE i,
     rows TYPE i,
     trips TYPE i,
     profile TYPE c LENGTH 200,
  END OF ts_year .
    TYPES:
    tt_year TYPE STANDARD TABLE OF ts_year .

    CONSTANTS gc_year TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name VALUE 'Year' ##NO_TEXT.

    METHODS load_text_elements
  FINAL
    RETURNING
      VALUE(rt_text_elements) TYPE tt_text_elements
    RAISING
      /iwbep/cx_mgw_med_exception .

    METHODS define
    REDEFINITION .
    METHODS get_last_modified
    REDEFINITION .
  PROTECTED SECTION.
  PRIVATE SECTION.

    CONSTANTS gc_incl_name TYPE string VALUE 'ZCL_ZOSD_TAXI_MPC=============CP' ##NO_TEXT.

    METHODS define_year
    RAISING
      /iwbep/cx_mgw_med_exception .
    METHODS define_actions
    RAISING
      /iwbep/cx_mgw_med_exception .
ENDCLASS.



CLASS ZCL_ZOSD_TAXI_MPC IMPLEMENTATION.


  METHOD define.
*&---------------------------------------------------------------------*
*&           Generated code for the MODEL PROVIDER BASE CLASS         &*
*&                                                                     &*
*&  !!!NEVER MODIFY THIS CLASS. IN CASE YOU WANT TO CHANGE THE MODEL  &*
*&        DO THIS IN THE MODEL PROVIDER SUBCLASS!!!                   &*
*&                                                                     &*
*&---------------------------------------------------------------------*

    model->set_schema_namespace( 'ZOSD_TAXI_SRV' ).

    define_year( ).
    define_actions( ).
  ENDMETHOD.


  METHOD define_actions.
*&---------------------------------------------------------------------*
*&           Generated code for the MODEL PROVIDER BASE CLASS         &*
*&                                                                     &*
*&  !!!NEVER MODIFY THIS CLASS. IN CASE YOU WANT TO CHANGE THE MODEL  &*
*&        DO THIS IN THE MODEL PROVIDER SUBCLASS!!!                   &*
*&                                                                     &*
*&---------------------------------------------------------------------*



    DATA:
lo_action         TYPE REF TO /iwbep/if_mgw_odata_action,                 "#EC NEEDED
lo_parameter      TYPE REF TO /iwbep/if_mgw_odata_parameter.              "#EC NEEDED

***********************************************************************************************************************************
*   ACTION - GenerateYear
***********************************************************************************************************************************

    lo_action = model->create_action( 'GenerateYear' ).  "#EC NOTEXT
*Set HTTP method GET or POST
    lo_action->set_http_method( 'POST' ). "#EC NOTEXT
* Set return type multiplicity
    lo_action->set_return_multiplicity( '' ). "#EC NOTEXT
***********************************************************************************************************************************
* Parameters
***********************************************************************************************************************************

    lo_parameter = lo_action->create_input_parameter( iv_parameter_name = 'Year'    iv_abap_fieldname = 'YEAR' ). "#EC NOTEXT
    lo_parameter->/iwbep/if_mgw_odata_property~set_type_edm_int32( ).
    lo_action->bind_input_structure( iv_structure_name  = 'ZCL_ZOSD_TAXI_MPC=>TS_GENERATEYEAR' ). "#EC NOTEXT

***********************************************************************************************************************************
*   ACTION - ResetData
***********************************************************************************************************************************

    lo_action = model->create_action( 'ResetData' ).  "#EC NOTEXT
*Set HTTP method GET or POST
    lo_action->set_http_method( 'POST' ). "#EC NOTEXT
* Set return type multiplicity
    lo_action->set_return_multiplicity( '' ). "#EC NOTEXT
  ENDMETHOD.


  METHOD define_year.
*&---------------------------------------------------------------------*
*&           Generated code for the MODEL PROVIDER BASE CLASS         &*
*&                                                                     &*
*&  !!!NEVER MODIFY THIS CLASS. IN CASE YOU WANT TO CHANGE THE MODEL  &*
*&        DO THIS IN THE MODEL PROVIDER SUBCLASS!!!                   &*
*&                                                                     &*
*&---------------------------------------------------------------------*


    DATA:
        lo_annotation     TYPE REF TO /iwbep/if_mgw_odata_annotation,                "#EC NEEDED
        lo_entity_type    TYPE REF TO /iwbep/if_mgw_odata_entity_typ,                "#EC NEEDED
        lo_complex_type   TYPE REF TO /iwbep/if_mgw_odata_cmplx_type,                "#EC NEEDED
        lo_property       TYPE REF TO /iwbep/if_mgw_odata_property,                  "#EC NEEDED
        lo_entity_set     TYPE REF TO /iwbep/if_mgw_odata_entity_set.                "#EC NEEDED

***********************************************************************************************************************************
*   ENTITY - Year
***********************************************************************************************************************************

    lo_entity_type = model->create_entity_type( iv_entity_type_name = 'Year' iv_def_entity_set = abap_false ). "#EC NOTEXT

***********************************************************************************************************************************
*Properties
***********************************************************************************************************************************

    lo_property = lo_entity_type->create_property( iv_property_name = 'Year' iv_abap_fieldname = 'YEAR' ). "#EC NOTEXT
    lo_property->set_is_key( ).
    lo_property->set_label_from_text_element( iv_text_element_symbol = '001' iv_text_element_container = gc_incl_name ).  "#EC NOTEXT
    lo_property->set_type_edm_int32( ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_false ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_false ).
    lo_property->set_filterable( abap_true ).
    lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
      EXPORTING
        iv_key      = 'unicode'
        iv_value    = 'false' ).
    lo_property = lo_entity_type->create_property( iv_property_name = 'Rows' iv_abap_fieldname = 'ROWS' ). "#EC NOTEXT
    lo_property->set_label_from_text_element( iv_text_element_symbol = '002' iv_text_element_container = gc_incl_name ).  "#EC NOTEXT
    lo_property->set_type_edm_int32( ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).
    lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
      EXPORTING
        iv_key      = 'unicode'
        iv_value    = 'false' ).
    lo_property = lo_entity_type->create_property( iv_property_name = 'Trips' iv_abap_fieldname = 'TRIPS' ). "#EC NOTEXT
    lo_property->set_label_from_text_element( iv_text_element_symbol = '003' iv_text_element_container = gc_incl_name ).  "#EC NOTEXT
    lo_property->set_type_edm_int32( ).
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).
    lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
      EXPORTING
        iv_key      = 'unicode'
        iv_value    = 'false' ).
    lo_property = lo_entity_type->create_property( iv_property_name = 'Profile' iv_abap_fieldname = 'PROFILE' ). "#EC NOTEXT
    lo_property->set_label_from_text_element( iv_text_element_symbol = '004' iv_text_element_container = gc_incl_name ).  "#EC NOTEXT
    lo_property->set_type_edm_string( ).
    lo_property->set_maxlength( iv_max_length = 200 ). "#EC NOTEXT
    lo_property->set_creatable( abap_true ).
    lo_property->set_updatable( abap_true ).
    lo_property->set_sortable( abap_true ).
    lo_property->set_nullable( abap_true ).
    lo_property->set_filterable( abap_true ).
    lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
      EXPORTING
        iv_key      = 'unicode'
        iv_value    = 'false' ).

    lo_entity_type->bind_structure( iv_structure_name  = 'ZCL_ZOSD_TAXI_MPC=>TS_YEAR' ). "#EC NOTEXT


***********************************************************************************************************************************
*   ENTITY SETS
***********************************************************************************************************************************
    lo_entity_set = lo_entity_type->create_entity_set( 'YearSet' ). "#EC NOTEXT

    lo_entity_set->set_creatable( abap_true ).
    lo_entity_set->set_updatable( abap_true ).
    lo_entity_set->set_deletable( abap_true ).

    lo_entity_set->set_pageable( abap_true ).
    lo_entity_set->set_addressable( abap_true ).
    lo_entity_set->set_has_ftxt_search( abap_false ).
    lo_entity_set->set_subscribable( abap_false ).
    lo_entity_set->set_filter_required( abap_false ).
  ENDMETHOD.


  METHOD get_last_modified.
*&---------------------------------------------------------------------*
*&           Generated code for the MODEL PROVIDER BASE CLASS         &*
*&                                                                     &*
*&  !!!NEVER MODIFY THIS CLASS. IN CASE YOU WANT TO CHANGE THE MODEL  &*
*&        DO THIS IN THE MODEL PROVIDER SUBCLASS!!!                   &*
*&                                                                     &*
*&---------------------------------------------------------------------*


    CONSTANTS: lc_gen_date_time TYPE timestamp VALUE '20260912000000'.                  "#EC NOTEXT
    rv_last_modified = super->get_last_modified( ).
    IF rv_last_modified LT lc_gen_date_time.
      rv_last_modified = lc_gen_date_time.
    ENDIF.
  ENDMETHOD.


  METHOD load_text_elements.
*&---------------------------------------------------------------------*
*&           Generated code for the MODEL PROVIDER BASE CLASS         &*
*&                                                                     &*
*&  !!!NEVER MODIFY THIS CLASS. IN CASE YOU WANT TO CHANGE THE MODEL  &*
*&        DO THIS IN THE MODEL PROVIDER SUBCLASS!!!                   &*
*&                                                                     &*
*&---------------------------------------------------------------------*


    DATA:
     ls_text_element TYPE ts_text_element.                                 "#EC NEEDED


    CLEAR ls_text_element.
    ls_text_element-artifact_name          = 'Year'.                 "#EC NOTEXT
    ls_text_element-artifact_type          = 'PROP'.                                       "#EC NOTEXT
    ls_text_element-parent_artifact_name   = 'Year'.                            "#EC NOTEXT
    ls_text_element-parent_artifact_type   = 'ETYP'.                                       "#EC NOTEXT
    ls_text_element-text_symbol            = '001'.              "#EC NOTEXT
    APPEND ls_text_element TO rt_text_elements.
    CLEAR ls_text_element.
    ls_text_element-artifact_name          = 'Rows'.                 "#EC NOTEXT
    ls_text_element-artifact_type          = 'PROP'.                                       "#EC NOTEXT
    ls_text_element-parent_artifact_name   = 'Year'.                            "#EC NOTEXT
    ls_text_element-parent_artifact_type   = 'ETYP'.                                       "#EC NOTEXT
    ls_text_element-text_symbol            = '002'.              "#EC NOTEXT
    APPEND ls_text_element TO rt_text_elements.
    CLEAR ls_text_element.
    ls_text_element-artifact_name          = 'Trips'.                 "#EC NOTEXT
    ls_text_element-artifact_type          = 'PROP'.                                       "#EC NOTEXT
    ls_text_element-parent_artifact_name   = 'Year'.                            "#EC NOTEXT
    ls_text_element-parent_artifact_type   = 'ETYP'.                                       "#EC NOTEXT
    ls_text_element-text_symbol            = '003'.              "#EC NOTEXT
    APPEND ls_text_element TO rt_text_elements.
    CLEAR ls_text_element.
    ls_text_element-artifact_name          = 'Profile'.                 "#EC NOTEXT
    ls_text_element-artifact_type          = 'PROP'.                                       "#EC NOTEXT
    ls_text_element-parent_artifact_name   = 'Year'.                            "#EC NOTEXT
    ls_text_element-parent_artifact_type   = 'ETYP'.                                       "#EC NOTEXT
    ls_text_element-text_symbol            = '004'.              "#EC NOTEXT
    APPEND ls_text_element TO rt_text_elements.
  ENDMETHOD.
ENDCLASS.
