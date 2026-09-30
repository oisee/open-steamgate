CLASS zcl_osd_dsl_mpc DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS entity_model
      IMPORTING is_type TYPE zcl_stg_segw_gen=>ty_entity_type
                iv_mpc TYPE string
      RETURNING VALUE(ri_model) TYPE REF TO zif_ajson
      RAISING cx_static_check.
    CLASS-METHODS entity_template RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS render_entity
      IMPORTING is_type TYPE zcl_stg_segw_gen=>ty_entity_type
                iv_mpc TYPE string
      RETURNING VALUE(rs_result) TYPE zcl_osd_tpl=>ty_result
      RAISING cx_static_check.
  PRIVATE SECTION.
    CLASS-METHODS flag_text IMPORTING iv_flag TYPE abap_bool RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS quoted IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_dsl_mpc IMPLEMENTATION.
  METHOD quoted.
    rv_text = `"` && zcl_stg_json=>escape( iv_text ) && `"`.
  ENDMETHOD.

  METHOD flag_text.
    IF iv_flag = abap_true.
      rv_text = 'X'.
    ENDIF.
  ENDMETHOD.

  METHOD entity_model.
    DATA lv_json TYPE string.
    DATA ls_prop TYPE zcl_stg_segw_gen=>ty_property.
    DATA ls_set TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA lv_first TYPE abap_bool.
    lv_json = `{"@id":` && quoted( `entity/` && is_type-name )
      && `,"name":` && quoted( is_type-name )
      && `,"define_stem":` && quoted( is_type-define_stem )
      && `,"type_stem":` && quoted( is_type-type_stem )
      && `,"mpc":` && quoted( iv_mpc )
      && `,"abap_struct":` && quoted( is_type-abap_struct )
      && `,"bind_ddic":` && quoted( is_type-abap_struct )
      && `,"media":` && quoted( flag_text( is_type-is_media ) )
      && `,"banner":` && quoted( zcl_stg_segw_gen=>banner( ) )
      && `,"stars":` && quoted( `***********************************************************************************************************************************` )
      && `,"properties":[`.
    lv_first = abap_true.
    LOOP AT is_type-properties INTO ls_prop.
      IF lv_first = abap_false.
        lv_json = lv_json && `,`.
      ENDIF.
      lv_first = abap_false.
      lv_json = lv_json && `{"@id":` && quoted( `entity/` && is_type-name && `/property/` && ls_prop-name )
        && `,"name":` && quoted( ls_prop-name )
        && `,"abap_field":` && quoted( ls_prop-abap_field )
        && `,"@type":{"@id":` && quoted( `entity/` && is_type-name && `/property/` && ls_prop-name && `/type` )
        && `,"built_in":` && quoted( ls_prop-type_kind )
        && `,"length":` && quoted( ls_prop-length )
        && `,"decimals":` && quoted( ls_prop-decimals )
        && `,"data_element":` && quoted( ls_prop-type_name ) && `}`
        && `,"complex":` && quoted( ls_prop-complex_type )
        && `,"complex_type":` && quoted( ls_prop-complex_type )
        && `,"key":` && quoted( flag_text( ls_prop-is_key ) )
        && `,"label":` && quoted( ls_prop-text_element )
        && `,"text_element":` && quoted( ls_prop-text_element )
        && `,"edm_setter":` && quoted( zcl_stg_segw_gen=>edm_setter( ls_prop-edm_type ) )
        && `,"precision":` && quoted( ls_prop-precision )
        && `,"max_length":` && quoted( ls_prop-max_length )
        && `,"semantics":` && quoted( ls_prop-semantics )
        && `,"etag":` && quoted( flag_text( ls_prop-as_etag ) )
        && `,"creatable":` && quoted( zcl_stg_segw_gen=>ab( ls_prop-creatable ) )
        && `,"updatable":` && quoted( zcl_stg_segw_gen=>ab( ls_prop-updatable ) )
        && `,"sortable":` && quoted( zcl_stg_segw_gen=>ab( ls_prop-sortable ) )
        && `,"nullable":` && quoted( zcl_stg_segw_gen=>ab( ls_prop-nullable ) )
        && `,"filterable":` && quoted( zcl_stg_segw_gen=>ab( ls_prop-filterable ) ) && `}`.
    ENDLOOP.
    lv_json = lv_json && `],"sets":[`.
    lv_first = abap_true.
    LOOP AT is_type-entity_sets INTO ls_set.
      IF lv_first = abap_false.
        lv_json = lv_json && `,`.
      ENDIF.
      lv_first = abap_false.
      lv_json = lv_json && `{"@id":` && quoted( `entity/` && is_type-name && `/set/` && ls_set-name )
        && `,"name":` && quoted( ls_set-name )
        && `,"creatable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-creatable ) )
        && `,"updatable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-updatable ) )
        && `,"deletable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-deletable ) )
        && `,"pageable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-pageable ) )
        && `,"addressable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-addressable ) )
        && `,"searchable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-searchable ) )
        && `,"subscribable":` && quoted( zcl_stg_segw_gen=>ab( ls_set-subscribable ) )
        && `,"filter_required":` && quoted( zcl_stg_segw_gen=>ab( ls_set-filter_required ) ) && `}`.
    ENDLOOP.
    lv_json = lv_json && `]}`.
    ri_model = zcl_ajson=>parse( lv_json ).
  ENDMETHOD.

  METHOD entity_template.
    rv_text = rv_text && `  method DEFINE_{{define_stem}}.` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{{banner}}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `  data:` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        lo_annotation     type ref to /iwbep/if_mgw_odata_annotation,                "#EC NEEDED` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        lo_entity_type    type ref to /iwbep/if_mgw_odata_entity_typ,                "#EC NEEDED` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        lo_complex_type   type ref to /iwbep/if_mgw_odata_cmplx_type,                "#EC NEEDED` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        lo_property       type ref to /iwbep/if_mgw_odata_property,                  "#EC NEEDED` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        lo_entity_set     type ref to /iwbep/if_mgw_odata_entity_set.                "#EC NEEDED` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `*   ENTITY - {{name}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_type = model->create_entity_type( iv_entity_type_name = '{{name}}' iv_def_entity_set = abap_false ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#media}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_type->set_is_media( 'X' ).  "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/media}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `*Properties` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#properties}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#complex}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_complex_type = lo_entity_type->create_complex_property( iv_property_name = '{{name}}'` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `                                                           iv_complex_type_name = '{{complex_type}}'` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `                                                           iv_abap_fieldname    = '{{abap_field}}' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/complex}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{^complex}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property = lo_entity_type->create_property( iv_property_name = '{{name}}' iv_abap_fieldname = '{{abap_field}}' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#key}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_is_key( ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/key}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#label}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_label_from_text_element( iv_text_element_symbol = '{{text_element}}' iv_text_element_container = gc_incl_name ).  "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/label}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_type_edm_{{edm_setter}}( ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#precision}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_precison( iv_precision = {{precision}} ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/precision}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#max_length}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_maxlength( iv_max_length = {{max_length}} ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/max_length}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#semantics}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_semantic( '{{semantics}}' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/semantics}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_creatable( {{creatable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_updatable( {{updatable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_sortable( {{sortable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_nullable( {{nullable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_filterable( {{filterable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->/iwbep/if_mgw_odata_annotatabl~create_annotation( 'sap' )->add(` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `      EXPORTING` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        iv_key      = 'unicode'` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `        iv_value    = 'false' ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#etag}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_property->set_as_etag( ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/etag}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/complex}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/properties}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{^properties}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/properties}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#bind_ddic}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_type->bind_structure( iv_structure_name   = '{{abap_struct}}'` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `                                iv_bind_conversions = 'X' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/bind_ddic}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{^bind_ddic}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_type->bind_structure( iv_structure_name  = '{{mpc}}=>TS_{{type_stem}}' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/bind_ddic}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `*   ENTITY SETS` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{stars}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{#sets}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set = lo_entity_type->create_entity_set( '{{name}}' ). "#EC NOTEXT` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_creatable( {{creatable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_updatable( {{updatable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_deletable( {{deletable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_pageable( {{pageable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_addressable( {{addressable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_has_ftxt_search( {{searchable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_subscribable( {{subscribable}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `lo_entity_set->set_filter_required( {{filter_required}} ).` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `{{/sets}}` && cl_abap_char_utilities=>newline.
    rv_text = rv_text && `  endmethod.` && cl_abap_char_utilities=>newline.
  ENDMETHOD.

  METHOD render_entity.
    rs_result = zcl_osd_tpl=>render(
      iv_template = entity_template( )
      ii_data = entity_model( is_type = is_type iv_mpc = iv_mpc )
      iv_name = 'mpc_entity' ).
  ENDMETHOD.
ENDCLASS.
