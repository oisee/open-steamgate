CLASS zcl_osd_dsl_mapping DEFINITION PUBLIC FINAL CREATE PRIVATE.
* Resolves mapping data only; formatting belongs to the DPC partials.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_prop,
             uuid      TYPE string,
             property  TYPE string,
             direction TYPE string,
             component TYPE string,
             ranges    TYPE zcl_stg_segw_gen=>tt_map_range,
           END OF ty_prop.
    TYPES tt_prop TYPE STANDARD TABLE OF ty_prop WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_constant,
             uuid      TYPE string,
             component TYPE string,
             value     TYPE string,
           END OF ty_constant.
    TYPES tt_constant TYPE STANDARD TABLE OF ty_constant WITH DEFAULT KEY.
* one variable per function module parameter the mapping touches
    TYPES: BEGIN OF ty_param,
             name      TYPE string,
             kind      TYPE string,
             sort_key  TYPE string,
             type      TYPE string,
             shape     TYPE string,
             is_log    TYPE abap_bool,
             constants TYPE tt_constant,
             props     TYPE tt_prop,
             ranges    TYPE tt_prop,
           END OF ty_param.
    TYPES tt_param TYPE STANDARD TABLE OF ty_param WITH DEFAULT KEY.
* an output or input with its parameter and property resolved
    TYPES: BEGIN OF ty_use,
             prop      TYPE ty_prop,
             param     TYPE ty_param,
             property  TYPE zcl_stg_segw_gen=>ty_property,
           END OF ty_use.
    TYPES tt_use TYPE STANDARD TABLE OF ty_use WITH DEFAULT KEY.
* an entity set that navigates into the entity and hands over a key
    TYPES: BEGIN OF ty_source,
             set_name TYPE string,
             entity   TYPE zcl_stg_segw_gen=>ty_entity_type,
             field    TYPE string,
             use      TYPE ty_use,
           END OF ty_source.
    TYPES tt_source TYPE STANDARD TABLE OF ty_source WITH DEFAULT KEY.

    CLASS-METHODS kind_by_name
      IMPORTING
        iv_name        TYPE string
      RETURNING
        VALUE(rv_kind) TYPE string.
    CLASS-METHODS shape_by_name
      IMPORTING
        iv_name         TYPE string
      RETURNING
        VALUE(rv_shape) TYPE string.
    CLASS-METHODS used_parameters
      IMPORTING
        is_op            TYPE zcl_stg_segw_gen=>ty_operation
        it_signature     TYPE zcl_stg_segw_fugr=>tt_param
      RETURNING
        VALUE(rt_params) TYPE tt_param.
    CLASS-METHODS bop_interface
      IMPORTING
        iv_fm          TYPE string
        it_artifacts   TYPE zcl_stg_segw_gen=>tt_artifact
      RETURNING
        VALUE(rv_name) TYPE string.
    CLASS-METHODS sort_key
      IMPORTING
        iv_name       TYPE string
      RETURNING
        VALUE(rv_key) TYPE string.
    CLASS-METHODS property_named
      IMPORTING
        is_type            TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_name            TYPE string
      EXPORTING
        ev_found           TYPE abap_bool
      RETURNING
        VALUE(rs_property) TYPE zcl_stg_segw_gen=>ty_property.
    CLASS-METHODS uses
      IMPORTING
        it_params      TYPE tt_param
        is_type        TYPE zcl_stg_segw_gen=>ty_entity_type
        iv_direction   TYPE string
        iv_ranges      TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(rt_uses) TYPE tt_use.
    CLASS-METHODS source_sets
      IMPORTING
        is_model          TYPE zcl_stg_segw_gen=>ty_model
        is_type           TYPE zcl_stg_segw_gen=>ty_entity_type
        is_property       TYPE zcl_stg_segw_gen=>ty_property
      RETURNING
        VALUE(rt_sources) TYPE tt_source.
ENDCLASS.

CLASS zcl_osd_dsl_mapping IMPLEMENTATION.
  METHOD kind_by_name.
* ------------------------------------------------------------ the mapping
* what a parameter is when the signature does not say: SAP naming
* (IV_/IS_/IT_ or I_ importing, E.. exporting, C.. changing, else tables)
    DATA lv_c1 TYPE string.
    DATA lv_c2 TYPE string.
    DATA lv_c3 TYPE string.

    IF strlen( iv_name ) >= 3.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
      lv_c3 = substring( val = iv_name off = 2 len = 1 ).
    ELSEIF strlen( iv_name ) = 2.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
    ENDIF.
    IF ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' )
        AND ( lv_c2 = '_' OR ( ( lv_c2 = 'V' OR lv_c2 = 'S' OR lv_c2 = 'T' ) AND lv_c3 = '_' ) ).
      CASE lv_c1.
        WHEN 'I'.
          rv_kind = 'importing'.
        WHEN 'E'.
          rv_kind = 'exporting'.
        WHEN 'C'.
          rv_kind = 'changing'.
      ENDCASE.
    ELSE.
      rv_kind = 'tables'.
    ENDIF.
  ENDMETHOD.

  METHOD shape_by_name.
* IT_/ET_/CT_ or T_ is a table, IS_/ES_/CS_ or S_ a structure, else a scalar
    DATA lv_c1 TYPE string.
    DATA lv_c2 TYPE string.
    DATA lv_c3 TYPE string.

    IF strlen( iv_name ) >= 3.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
      lv_c3 = substring( val = iv_name off = 2 len = 1 ).
    ELSEIF strlen( iv_name ) = 2.
      lv_c1 = substring( val = iv_name off = 0 len = 1 ).
      lv_c2 = substring( val = iv_name off = 1 len = 1 ).
    ENDIF.
    IF ( lv_c1 = 'T' AND lv_c2 = '_' )
        OR ( ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' ) AND lv_c2 = 'T' AND lv_c3 = '_' ).
      rv_shape = 'table'.
    ELSEIF ( lv_c1 = 'S' AND lv_c2 = '_' )
        OR ( ( lv_c1 = 'I' OR lv_c1 = 'E' OR lv_c1 = 'C' ) AND lv_c2 = 'S' AND lv_c3 = '_' ).
      rv_shape = 'structure'.
    ELSE.
      rv_shape = 'scalar'.
    ENDIF.
  ENDMETHOD.

  METHOD used_parameters.
    DATA ls_mp       TYPE zcl_stg_segw_gen=>ty_map_prop.
    DATA ls_range    TYPE zcl_stg_segw_gen=>ty_map_range.
    DATA ls_sig      TYPE zcl_stg_segw_fugr=>ty_param.
    DATA ls_param    TYPE ty_param.
    DATA ls_prop     TYPE ty_prop.
    DATA ls_constant TYPE ty_constant.
    DATA lv_root     TYPE string.
    DATA lv_component TYPE string.
    DATA lv_at       TYPE i.
    DATA lv_has_ranges TYPE abap_bool.
    FIELD-SYMBOLS <ls_param> TYPE ty_param.

    LOOP AT is_op-props INTO ls_mp.
      lv_at = find( val = ls_mp-ds_att_path sub = '\' ).
      IF lv_at < 0.
        lv_root = ls_mp-ds_att_path.
        CLEAR lv_component.
      ELSE.
        lv_root = substring( val = ls_mp-ds_att_path len = lv_at ).
        lv_component = substring( val = ls_mp-ds_att_path off = lv_at + 1 ).
        lv_at = find( val = lv_component sub = '\' ).
        IF lv_at >= 0.
          lv_component = substring( val = lv_component len = lv_at ).
        ENDIF.
      ENDIF.
      READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      IF sy-subrc <> 0.
        CLEAR ls_param.
        ls_param-name  = lv_root.
        ls_param-shape = shape_by_name( lv_root ).
        LOOP AT it_signature INTO ls_sig WHERE name = lv_root.
          ls_param-kind = ls_sig-kind.
          ls_param-type = ls_sig-type.
        ENDLOOP.
        IF ls_param-kind IS INITIAL.
          ls_param-kind = kind_by_name( lv_root ).
        ENDIF.
        APPEND ls_param TO rt_params.
        READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      ENDIF.
      CLEAR ls_prop.
      ls_prop-uuid      = ls_mp-uuid.
      ls_prop-property  = ls_mp-property.
      ls_prop-direction = ls_mp-direction.
      ls_prop-component = lv_component.
      LOOP AT is_op-ranges INTO ls_range WHERE mp_uuid = ls_mp-uuid.
        APPEND ls_range TO ls_prop-ranges.
      ENDLOOP.
      lv_has_ranges = xsdbool( ls_prop-ranges IS NOT INITIAL ).
      IF ( lv_component IS NOT INITIAL OR lv_has_ranges = abap_true ) AND <ls_param>-shape = 'scalar'.
        <ls_param>-shape = 'structure'.
      ENDIF.
      IF lv_has_ranges = abap_true.
        <ls_param>-shape = 'table'.
        APPEND ls_prop TO <ls_param>-ranges.
      ELSEIF ls_mp-has_constant = abap_true.
        ls_constant-uuid      = ls_mp-uuid.
        ls_constant-component = lv_component.
        ls_constant-value     = ls_mp-constant.
        APPEND ls_constant TO <ls_param>-constants.
      ELSE.
        APPEND ls_prop TO <ls_param>-props.
      ENDIF.
    ENDLOOP.
    IF is_op-log_attr IS NOT INITIAL.
      lv_root = is_op-log_attr.
      lv_at = find( val = lv_root sub = '\' ).
      IF lv_at >= 0.
        lv_root = substring( val = lv_root len = lv_at ).
      ENDIF.
      READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      IF sy-subrc <> 0.
        CLEAR ls_param.
        ls_param-name  = lv_root.
        ls_param-shape = shape_by_name( lv_root ).
        LOOP AT it_signature INTO ls_sig WHERE name = lv_root.
          ls_param-kind = ls_sig-kind.
          ls_param-type = ls_sig-type.
        ENDLOOP.
        IF ls_param-kind IS INITIAL.
          ls_param-kind = kind_by_name( lv_root ).
        ENDIF.
        APPEND ls_param TO rt_params.
        READ TABLE rt_params ASSIGNING <ls_param> WITH KEY name = lv_root.
      ENDIF.
      <ls_param>-shape  = 'table'.
      <ls_param>-is_log = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD bop_interface.
* SEGW copies the DDIC types the module uses into one generated interface
* per module (artifact type BOP), IF_ + the module name cut to 30 with a
* number where it collides. Newer trees say which module (RFC_NAME), older
* ones only have the name; the last match is the current one.
    DATA ls_art  TYPE zcl_stg_segw_gen=>ty_artifact.
    DATA lv_stem TYPE string.
    DATA lv_at   TYPE i.
    DATA lv_len  TYPE i.

    LOOP AT it_artifacts INTO ls_art WHERE art_type = 'BOP' AND rfc_name = iv_fm.
      rv_name = ls_art-name.
    ENDLOOP.
    IF rv_name IS NOT INITIAL.
      RETURN.
    ENDIF.
    LOOP AT it_artifacts INTO ls_art WHERE art_type = 'BOP'.
      lv_stem = ls_art-name.
      IF strlen( lv_stem ) > 0 AND lv_stem(1) = '/'.
        lv_at = find( val = lv_stem sub = '/' off = 1 ).
        IF lv_at > 0.
          lv_stem = substring( val = lv_stem off = lv_at + 1 ).
        ENDIF.
      ENDIF.
      IF strlen( lv_stem ) >= 3 AND substring( val = lv_stem len = 3 ) = 'IF_'.
        lv_stem = substring( val = lv_stem off = 3 ).
      ENDIF.
      lv_len = strlen( lv_stem ).
      WHILE lv_len > 0 AND substring( val = lv_stem off = lv_len - 1 len = 1 ) CO '0123456789'.
        lv_len = lv_len - 1.
      ENDWHILE.
      lv_stem = substring( val = lv_stem len = lv_len ).
      IF lv_stem IS INITIAL.
        rv_name = ls_art-name.
        CONTINUE.
      ENDIF.
      IF strlen( iv_fm ) >= strlen( lv_stem ) AND substring( val = iv_fm len = strlen( lv_stem ) ) = lv_stem.
        rv_name = ls_art-name.
      ELSEIF strlen( lv_stem ) >= strlen( iv_fm ) AND substring( val = lv_stem len = strlen( iv_fm ) ) = iv_fm.
        rv_name = ls_art-name.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD sort_key.
    rv_key = replace( val = iv_name sub = '_' with = '/' occ = 0 ).
  ENDMETHOD.

  METHOD property_named.
    DATA ls_property TYPE zcl_stg_segw_gen=>ty_property.

    CLEAR ev_found.
    LOOP AT is_type-properties INTO ls_property.
      IF ls_property-name = iv_name.
        rs_property = ls_property.
        ev_found = abap_true.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD uses.
* the props (or the ranges) of every parameter in a direction, with the
* entity property they name; unknown properties are left out
    DATA ls_param TYPE ty_param.
    DATA ls_prop  TYPE ty_prop.
    DATA ls_use   TYPE ty_use.
    DATA lv_found TYPE abap_bool.

    LOOP AT it_params INTO ls_param.
      IF iv_ranges = abap_true.
        LOOP AT ls_param-ranges INTO ls_prop.
          CLEAR ls_use.
          ls_use-prop  = ls_prop.
          ls_use-param = ls_param.
          ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
          IF lv_found = abap_true.
            APPEND ls_use TO rt_uses.
          ENDIF.
        ENDLOOP.
      ELSE.
        LOOP AT ls_param-props INTO ls_prop WHERE direction = iv_direction.
          CLEAR ls_use.
          ls_use-prop  = ls_prop.
          ls_use-param = ls_param.
          ls_use-property = property_named( EXPORTING is_type = is_type iv_name = ls_prop-property IMPORTING ev_found = lv_found ).
          IF lv_found = abap_true.
            APPEND ls_use TO rt_uses.
          ENDIF.
        ENDLOOP.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD source_sets.
* the entity sets that navigate into this entity and hand over the key
* property through a referential constraint
    DATA ls_assoc  TYPE zcl_stg_segw_gen=>ty_association.
    DATA ls_rc     TYPE zcl_stg_segw_gen=>ty_constraint.
    DATA ls_left   TYPE zcl_stg_segw_gen=>ty_entity_type.
    DATA ls_set    TYPE zcl_stg_segw_gen=>ty_entity_set.
    DATA ls_principal TYPE zcl_stg_segw_gen=>ty_property.
    DATA ls_source TYPE ty_source.
    DATA lv_found  TYPE abap_bool.

    LOOP AT is_model-associations INTO ls_assoc WHERE right_type = is_type-name.
      LOOP AT ls_assoc-constraints INTO ls_rc WHERE dependent = is_property-name.
        READ TABLE is_model-entity_types INTO ls_left WITH KEY name = ls_assoc-left_type.
        IF sy-subrc <> 0.
          CONTINUE.
        ENDIF.
        ls_principal = property_named( EXPORTING is_type = ls_left iv_name = ls_rc-principal IMPORTING ev_found = lv_found ).
        LOOP AT ls_left-entity_sets INTO ls_set.
          CLEAR ls_source.
          ls_source-set_name = ls_set-name.
          ls_source-entity   = ls_left.
          IF lv_found = abap_true.
            ls_source-field = ls_principal-abap_field.
          ELSE.
            ls_source-field = ls_rc-principal.
          ENDIF.
          APPEND ls_source TO rt_sources.
        ENDLOOP.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
