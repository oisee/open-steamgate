CLASS zcl_zstg_demo_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_demo_dpc CREATE PUBLIC.
* The hand-written part a developer owns on a real system. Reads the
* select-options the Gateway hands over, runs Open SQL, applies paging.
  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS travelset_get_entityset REDEFINITION.
    METHODS travelset_get_entity REDEFINITION.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_range,
             sign   TYPE c LENGTH 1,
             option TYPE c LENGTH 2,
             low    TYPE c LENGTH 8,
             high   TYPE c LENGTH 8,
           END OF ty_range.
    TYPES ty_ranges TYPE STANDARD TABLE OF ty_range WITH DEFAULT KEY.

    METHODS ranges_for
      IMPORTING
        iv_property      TYPE string
        it_filter        TYPE /iwbep/t_mgw_select_option
      RETURNING
        VALUE(rt_ranges) TYPE ty_ranges.
ENDCLASS.

CLASS zcl_zstg_demo_dpc_ext IMPLEMENTATION.

  METHOD ranges_for.
    DATA ls_filter TYPE /iwbep/s_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.
    DATA ls_range  TYPE ty_range.

    LOOP AT it_filter INTO ls_filter.
      IF to_upper( ls_filter-property ) <> to_upper( iv_property ).
        CONTINUE.
      ENDIF.
      LOOP AT ls_filter-select_options INTO ls_option.
        ls_range-sign   = ls_option-sign.
        ls_range-option = ls_option-option.
        ls_range-low    = ls_option-low.
        ls_range-high   = ls_option-high.
        APPEND ls_range TO rt_ranges.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD travelset_get_entityset.
    DATA lt_travel_id TYPE ty_ranges.
    DATA lt_status    TYPE ty_ranges.
    DATA lv_skip      TYPE i.
    DATA lv_top       TYPE i.
    DATA lv_index     TYPE i.

    lt_travel_id = ranges_for( iv_property = 'TravelId'
                               it_filter   = it_filter_select_options ).
    lt_status = ranges_for( iv_property = 'Status'
                            it_filter   = it_filter_select_options ).

    SELECT travel_id description status seats
      FROM zstg_demo
      INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE travel_id IN lt_travel_id
        AND status IN lt_status
      ORDER BY travel_id.

* paging the way most hand-written DPCs do it: after the SELECT
    lv_skip = is_paging-skip.
    lv_top  = is_paging-top.
    IF lv_skip > 0.
      DO lv_skip TIMES.
        DELETE et_entityset INDEX 1.
      ENDDO.
    ENDIF.
    IF lv_top > 0.
      lv_index = lv_top + 1.
      WHILE lines( et_entityset ) >= lv_index.
        DELETE et_entityset INDEX lv_index.
      ENDWHILE.
    ENDIF.
  ENDMETHOD.

  METHOD travelset_get_entity.
    DATA ls_key       TYPE /iwbep/s_mgw_name_value_pair.
    DATA lv_travel_id TYPE c LENGTH 8.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'TravelId'.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception.
    ENDIF.
    lv_travel_id = ls_key-value.

    SELECT SINGLE travel_id description status seats
      FROM zstg_demo
      INTO CORRESPONDING FIELDS OF er_entity
      WHERE travel_id = lv_travel_id.
  ENDMETHOD.

ENDCLASS.
