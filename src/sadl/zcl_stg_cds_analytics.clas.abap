CLASS zcl_stg_cds_analytics DEFINITION PUBLIC FINAL CREATE PUBLIC.
* The analytical marks of a CDS view's OData model, for a service the
* SADL exposure does not build: a view published with @OData.publish
* (tools/cds2ddic.mjs, then tools/stg-compile.mjs) gets its entity type,
* set and properties from the generated _MPC, and its _MPC_EXT calls MARK
* after super->define( ). The marks are the ones cl_sadl_gw_model_exposure
* sets for the SADL service, read from the same registry and the same
* annotations: sap:semantics="aggregate" on the entity type and the set,
* sap:aggregation-role on each property. The set's mark is what makes
* zcl_stg_sadl_dpc answer $select on a cube by grouping.
  PUBLIC SECTION.
* @Analytics.dataCategory: #CUBE or #AGGREGATIONLEVEL, or @Analytics.query
    CLASS-METHODS is_aggregate
      IMPORTING
        is_entity     TYPE zcl_stg_cds_registry=>ty_entity
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.

* the function of @Aggregation.default (SUM, MIN, ...), initial for none
    CLASS-METHODS aggregation_of
      IMPORTING
        is_field           TYPE zcl_stg_cds_registry=>ty_field
      RETURNING
        VALUE(rv_function) TYPE string.

    CLASS-METHODS mark
      IMPORTING
        io_model       TYPE REF TO /iwbep/if_mgw_odata_model
        iv_cds         TYPE string
        iv_entity_type TYPE string
      RAISING
        /iwbep/cx_mgw_med_exception.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_stg_cds_analytics IMPLEMENTATION.

  METHOD is_aggregate.
    FIND REGEX '@Analytics\.(dataCategory:\s*#(CUBE|AGGREGATIONLEVEL)|query:\s*true)'
      IN TABLE is_entity-annotations IGNORING CASE.
    rv_yes = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD aggregation_of.
    FIND REGEX '@Aggregation\.default:\s*#(\w+)' IN TABLE is_field-annotations
      IGNORING CASE SUBMATCHES rv_function.
    IF sy-subrc <> 0.
      CLEAR rv_function.
    ENDIF.
    rv_function = to_upper( rv_function ).
    IF rv_function = 'NONE'.
      CLEAR rv_function.
    ENDIF.
  ENDMETHOD.

  METHOD mark.
    DATA ls_entity    TYPE zcl_stg_cds_registry=>ty_entity.
    DATA ls_field     TYPE zcl_stg_cds_registry=>ty_field.
    DATA lo_type      TYPE REF TO /iwbep/if_mgw_odata_entity_typ.
    DATA lo_oao_type  TYPE REF TO zcl_oao_entity_typ.
    DATA lo_property  TYPE REF TO /iwbep/if_mgw_odata_property.
    DATA lo_set_anno  TYPE REF TO /iwbep/if_mgw_odata_annotatabl.
    DATA lt_sets      TYPE zcl_oao_entity_typ=>ty_entity_sets.
    DATA ls_set       LIKE LINE OF lt_sets.
    DATA lv_type_name TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name.
    DATA lv_prop_name TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name.
    DATA lv_role      TYPE string.

    ls_entity = zcl_stg_cds_registry=>get( iv_cds ).
    IF ls_entity-name IS INITIAL OR is_aggregate( ls_entity ) = abap_false.
      RETURN.
    ENDIF.

    lv_type_name = iv_entity_type.
    lo_type = io_model->get_entity_type( lv_type_name ).
    lo_type->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
      iv_key   = 'semantics'
      iv_value = 'aggregate' ).

* measures carry an aggregation, everything else is a dimension
    LOOP AT ls_entity-fields INTO ls_field.
      lv_prop_name = ls_field-name.
      lo_property = lo_type->get_property( lv_prop_name ).
      IF lo_property IS NOT BOUND.
        CONTINUE.
      ENDIF.
      IF aggregation_of( ls_field ) IS INITIAL.
        lv_role = 'dimension'.
      ELSE.
        lv_role = 'measure'.
      ENDIF.
      lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(
        iv_key   = 'aggregation-role'
        iv_value = lv_role ).
    ENDLOOP.

* the set's mark is the one the dispatcher reads (zcl_stg_model_info)
    lo_oao_type ?= lo_type.
    lt_sets = lo_oao_type->get_entity_sets( ).
    LOOP AT lt_sets INTO ls_set.
      lo_set_anno ?= ls_set-entity_set.
      lo_set_anno->create_annotation( 'sap' )->add(
        iv_key   = 'semantics'
        iv_value = 'aggregate' ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
