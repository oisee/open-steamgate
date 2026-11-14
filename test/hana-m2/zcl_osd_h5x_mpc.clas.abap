CLASS zcl_osd_h5x_mpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_model CREATE PUBLIC.
* The model shape of a SEGW sample's business set, synthetic: an entity
* type whose first property is a complex property (an address), keys and
* texts after it, a DEC 21,7 timestamp as Edm.DateTime. Read by the DPC
* beside it with a join and an INTO list (docs/hana-milestone-2.md).
  PUBLIC SECTION.
    TYPES: BEGIN OF ts_address,
             city    TYPE c LENGTH 40,
             country TYPE c LENGTH 3,
           END OF ts_address.
    TYPES: BEGIN OF ts_partner,
             address    TYPE ts_address,
             partner_id TYPE c LENGTH 10,
             name       TYPE c LENGTH 80,
             changed_at TYPE p LENGTH 11 DECIMALS 7,
           END OF ts_partner.
    TYPES tt_partner TYPE STANDARD TABLE OF ts_partner WITH DEFAULT KEY.
    METHODS define REDEFINITION.
ENDCLASS.

CLASS zcl_osd_h5x_mpc IMPLEMENTATION.
  METHOD define.
    DATA lo_complex TYPE REF TO /iwbep/if_mgw_odata_cmplx_type.
    DATA lo_type    TYPE REF TO /iwbep/if_mgw_odata_entity_typ.
    DATA lo_prop    TYPE REF TO /iwbep/if_mgw_odata_property.

    model->set_schema_namespace( 'ZOSD_H5X' ).

    lo_complex = model->create_complex_type( 'CT_Address' ).
    lo_prop = lo_complex->create_property( iv_property_name  = 'City'
                                           iv_abap_fieldname = 'CITY' ).
    lo_prop->set_type_edm_string( ).
    lo_prop->set_maxlength( 40 ).
    lo_prop = lo_complex->create_property( iv_property_name  = 'Country'
                                           iv_abap_fieldname = 'COUNTRY' ).
    lo_prop->set_type_edm_string( ).
    lo_prop->set_maxlength( 3 ).
    lo_complex->bind_structure( 'ZCL_OSD_H5X_MPC=>TS_ADDRESS' ).

    lo_type = model->create_entity_type( iv_entity_type_name = 'Partner'
                                         iv_def_entity_set   = abap_false ).
    lo_type->create_complex_property( iv_property_name     = 'Address'
                                      iv_complex_type_name = 'CT_Address'
                                      iv_abap_fieldname    = 'ADDRESS' ).
    lo_prop = lo_type->create_property( iv_property_name  = 'PartnerID'
                                        iv_abap_fieldname = 'PARTNER_ID' ).
    lo_prop->set_type_edm_string( ).
    lo_prop->set_is_key( ).
    lo_prop->set_maxlength( 10 ).
    lo_prop = lo_type->create_property( iv_property_name  = 'Name'
                                        iv_abap_fieldname = 'NAME' ).
    lo_prop->set_type_edm_string( ).
    lo_prop->set_maxlength( 80 ).
    lo_prop = lo_type->create_property( iv_property_name  = 'ChangedAt'
                                        iv_abap_fieldname = 'CHANGED_AT' ).
    lo_prop->set_type_edm_datetime( ).
    lo_type->bind_structure( 'ZCL_OSD_H5X_MPC=>TS_PARTNER' ).
    lo_type->create_entity_set( 'PartnerSet' ).
  ENDMETHOD.
ENDCLASS.
