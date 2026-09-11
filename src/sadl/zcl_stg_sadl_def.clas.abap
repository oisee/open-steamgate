CLASS zcl_stg_sadl_def DEFINITION PUBLIC CREATE PUBLIC.
* The <sadl:definition> a SEGW reference-data-source MPC/DPC carries as a
* string: data sources, exposed structures, their associations.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_data_source,
             name    TYPE string,
             type    TYPE string,
             binding TYPE string,
           END OF ty_data_source.
    TYPES tt_data_source TYPE STANDARD TABLE OF ty_data_source WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_association,
             name        TYPE string,
             binding     TYPE string,
             target      TYPE string,
             cardinality TYPE string,
           END OF ty_association.
    TYPES tt_association TYPE STANDARD TABLE OF ty_association WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_structure,
             name          TYPE string,
             data_source   TYPE string,
             max_edit_mode TYPE string,
             exposure      TYPE abap_bool,
             associations  TYPE tt_association,
           END OF ty_structure.
    TYPES tt_structure TYPE STANDARD TABLE OF ty_structure WITH DEFAULT KEY.

    DATA mt_data_sources TYPE tt_data_source READ-ONLY.
    DATA mt_structures   TYPE tt_structure READ-ONLY.

    METHODS constructor
      IMPORTING
        iv_sadl_xml TYPE string.

    METHODS structure_by_set
      IMPORTING
        iv_entity_set       TYPE string
      RETURNING
        VALUE(rs_structure) TYPE ty_structure.

    METHODS structure_by_name
      IMPORTING
        iv_name             TYPE string
      RETURNING
        VALUE(rs_structure) TYPE ty_structure.

    METHODS binding_of
      IMPORTING
        iv_data_source    TYPE string
      RETURNING
        VALUE(rv_binding) TYPE string.

    CLASS-METHODS set_name_of
      IMPORTING
        iv_structure   TYPE string
      RETURNING
        VALUE(rv_name) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS attribute
      IMPORTING
        iv_tag          TYPE string
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS zcl_stg_sadl_def IMPLEMENTATION.

  METHOD attribute.
    DATA lv_pattern TYPE string.

    lv_pattern = |\\b{ iv_name }="([^"]*)"|.
    FIND REGEX lv_pattern IN iv_tag SUBMATCHES rv_value.
    IF sy-subrc <> 0.
      CLEAR rv_value.
    ENDIF.
  ENDMETHOD.

  METHOD set_name_of.
    rv_name = |{ iv_structure }Set|.
  ENDMETHOD.

  METHOD constructor.
    DATA lv_xml       TYPE string.
    DATA lv_off       TYPE i.
    DATA lv_len       TYPE i.
    DATA lv_tag       TYPE string.
    DATA ls_source    TYPE ty_data_source.
    DATA ls_structure TYPE ty_structure.
    DATA ls_assoc     TYPE ty_association.
    DATA lv_in_struct TYPE abap_bool.
    DATA lv_count     TYPE i.

    lv_xml = iv_sadl_xml.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_xml WITH ` `.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_xml WITH ` `.

* walk the tags; the definition is flat enough for that
    DO.
      FIND FIRST OCCURRENCE OF '<' IN SECTION OFFSET lv_off OF lv_xml MATCH OFFSET lv_off.
      IF sy-subrc <> 0.
        EXIT.
      ENDIF.
      FIND FIRST OCCURRENCE OF '>' IN SECTION OFFSET lv_off OF lv_xml MATCH OFFSET lv_len.
      IF sy-subrc <> 0.
        EXIT.
      ENDIF.
      lv_count = lv_len - lv_off + 1.
      lv_tag = lv_xml+lv_off(lv_count).
      lv_off = lv_len + 1.

      IF lv_tag CP '<sadl:dataSource *'.
        CLEAR ls_source.
        ls_source-name    = to_upper( attribute( iv_tag = lv_tag iv_name = 'name' ) ).
        ls_source-type    = attribute( iv_tag = lv_tag iv_name = 'type' ).
        ls_source-binding = to_upper( attribute( iv_tag = lv_tag iv_name = 'binding' ) ).
        IF ls_source-binding IS INITIAL.
          ls_source-binding = ls_source-name.
        ENDIF.
        APPEND ls_source TO mt_data_sources.
      ELSEIF lv_tag CP '<sadl:structure *'.
        CLEAR ls_structure.
        ls_structure-name          = attribute( iv_tag = lv_tag iv_name = 'name' ).
        ls_structure-data_source   = to_upper( attribute( iv_tag = lv_tag iv_name = 'dataSource' ) ).
        ls_structure-max_edit_mode = attribute( iv_tag = lv_tag iv_name = 'maxEditMode' ).
        IF to_upper( attribute( iv_tag = lv_tag iv_name = 'exposure' ) ) = 'TRUE'.
          ls_structure-exposure = abap_true.
        ENDIF.
        lv_in_struct = abap_true.
        IF lv_tag CP '*/>'.
          APPEND ls_structure TO mt_structures.
          lv_in_struct = abap_false.
        ENDIF.
      ELSEIF lv_tag CP '<sadl:association *' AND lv_in_struct = abap_true.
        CLEAR ls_assoc.
        ls_assoc-name        = attribute( iv_tag = lv_tag iv_name = 'name' ).
        ls_assoc-binding     = to_upper( attribute( iv_tag = lv_tag iv_name = 'binding' ) ).
        ls_assoc-target      = attribute( iv_tag = lv_tag iv_name = 'target' ).
        ls_assoc-cardinality = attribute( iv_tag = lv_tag iv_name = 'cardinality' ).
        APPEND ls_assoc TO ls_structure-associations.
      ELSEIF lv_tag = '</sadl:structure>'.
        APPEND ls_structure TO mt_structures.
        lv_in_struct = abap_false.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD structure_by_set.
    DATA ls_structure TYPE ty_structure.

    LOOP AT mt_structures INTO ls_structure.
      IF to_upper( set_name_of( ls_structure-name ) ) = to_upper( iv_entity_set ).
        rs_structure = ls_structure.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD structure_by_name.
    DATA ls_structure TYPE ty_structure.

    LOOP AT mt_structures INTO ls_structure.
      IF to_upper( ls_structure-name ) = to_upper( iv_name ).
        rs_structure = ls_structure.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD binding_of.
    DATA ls_source TYPE ty_data_source.

    READ TABLE mt_data_sources INTO ls_source WITH KEY name = to_upper( iv_data_source ).
    IF sy-subrc = 0.
      rv_binding = ls_source-binding.
    ELSE.
      rv_binding = to_upper( iv_data_source ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
