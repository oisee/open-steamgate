CLASS zcl_zstg_demo_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_demo_dpc CREATE PUBLIC.
* The hand-written part a developer owns on a real system. Reads the
* select-options the Gateway hands over, runs Open SQL, applies paging.
  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~create_deep_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_expanded_entityset REDEFINITION.
  PROTECTED SECTION.
    METHODS travelset_get_entityset REDEFINITION.
    METHODS travelset_get_entity REDEFINITION.
    METHODS travelset_create_entity REDEFINITION.
    METHODS travelset_update_entity REDEFINITION.
    METHODS travelset_delete_entity REDEFINITION.
    METHODS bookingset_get_entityset REDEFINITION.
    METHODS bookingset_get_entity REDEFINITION.
    METHODS statusvhset_get_entityset REDEFINITION.
  PRIVATE SECTION.
    TYPES ty_travel_id TYPE c LENGTH 8.
    TYPES: BEGIN OF ty_range,
             sign   TYPE c LENGTH 1,
             option TYPE c LENGTH 2,
             low    TYPE c LENGTH 8,
             high   TYPE c LENGTH 8,
           END OF ty_range.
    TYPES ty_ranges TYPE STANDARD TABLE OF ty_range WITH DEFAULT KEY.

    METHODS key_from
      IMPORTING
        it_key_tab          TYPE /iwbep/t_mgw_name_value_pair
      RETURNING
        VALUE(rv_travel_id) TYPE ty_travel_id
      RAISING
        /iwbep/cx_mgw_busi_exception.

    METHODS key_value
      IMPORTING
        it_key_tab      TYPE /iwbep/t_mgw_name_value_pair
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.

    METHODS fill_status_text
      CHANGING
        ct_travel TYPE zcl_zstg_demo_mpc=>tt_travel.
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
    DATA lt_travel_id   TYPE ty_ranges.
    DATA lt_status      TYPE ty_ranges.
    DATA lt_description TYPE ty_ranges.
    DATA lt_seats       TYPE ty_ranges.
    DATA lv_skip        TYPE i.
    DATA lv_top         TYPE i.
    DATA lv_index       TYPE i.

* every filterable property becomes a range; startswith/substringof arrive
* as CP patterns and go to the database as LIKE
    lt_travel_id = ranges_for( iv_property = 'TravelId'
                               it_filter   = it_filter_select_options ).
    lt_status = ranges_for( iv_property = 'Status'
                            it_filter   = it_filter_select_options ).
    lt_description = ranges_for( iv_property = 'Description'
                                 it_filter   = it_filter_select_options ).
    lt_seats = ranges_for( iv_property = 'Seats'
                           it_filter   = it_filter_select_options ).

    SELECT travel_id description status seats
      FROM zstg_demo
      INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE travel_id IN lt_travel_id
        AND status IN lt_status
        AND description IN lt_description
        AND seats IN lt_seats
      ORDER BY travel_id.
    fill_status_text( CHANGING ct_travel = et_entityset ).

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

  METHOD key_from.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = 'TravelId'.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'Key TravelId missing'.
    ENDIF.
    rv_travel_id = ls_key-value.
  ENDMETHOD.

  METHOD travelset_create_entity.
    DATA ls_row TYPE zstg_demo.

    io_data_provider->read_entry_data( IMPORTING es_data = er_entity ).
    IF er_entity-travel_id IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'TravelId is required'.
    ENDIF.

    ls_row-mandt = sy-mandt.
    MOVE-CORRESPONDING er_entity TO ls_row.
    INSERT zstg_demo FROM ls_row.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |Travel { er_entity-travel_id } already exists|.
    ENDIF.
  ENDMETHOD.

  METHOD travelset_update_entity.
    DATA lv_travel_id TYPE c LENGTH 8.
    DATA ls_row       TYPE zstg_demo.

    lv_travel_id = key_from( it_key_tab ).
    io_data_provider->read_entry_data( IMPORTING es_data = er_entity ).
    er_entity-travel_id = lv_travel_id.

    SELECT SINGLE * FROM zstg_demo INTO ls_row WHERE travel_id = lv_travel_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |Travel { lv_travel_id } does not exist|.
    ENDIF.
    MOVE-CORRESPONDING er_entity TO ls_row.
    UPDATE zstg_demo FROM ls_row.
  ENDMETHOD.

  METHOD travelset_delete_entity.
    DATA lv_travel_id TYPE c LENGTH 8.

    lv_travel_id = key_from( it_key_tab ).
    DELETE FROM zstg_demo WHERE travel_id = lv_travel_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |Travel { lv_travel_id } does not exist|.
    ENDIF.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~create_deep_entity.
* Travel with bookings in one request. The deep structure is read from the
* provider, the header inserted, the items inserted with the header key.
    DATA ls_deep    TYPE zcl_zstg_demo_mpc=>ts_travel_deep.
    DATA ls_travel  TYPE zstg_demo.
    DATA ls_booking TYPE zstg_demo_bk.
    FIELD-SYMBOLS <ls_item> TYPE zcl_zstg_demo_mpc=>ts_booking.

    IF iv_entity_set_name <> 'TravelSet'.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
        EXPORTING
          textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
          method = 'CREATE_DEEP_ENTITY'.
    ENDIF.

    io_data_provider->read_entry_data( IMPORTING es_data = ls_deep ).
    IF ls_deep-travel_id IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'TravelId is required'.
    ENDIF.

    ls_travel-mandt = sy-mandt.
    MOVE-CORRESPONDING ls_deep TO ls_travel.
    INSERT zstg_demo FROM ls_travel.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |Travel { ls_deep-travel_id } already exists|.
    ENDIF.

    LOOP AT ls_deep-to_bookings ASSIGNING <ls_item>.
      <ls_item>-travel_id = ls_deep-travel_id.
      CLEAR ls_booking.
      ls_booking-mandt = sy-mandt.
      MOVE-CORRESPONDING <ls_item> TO ls_booking.
      INSERT zstg_demo_bk FROM ls_booking.
      IF sy-subrc <> 0.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
          EXPORTING
            message = |Booking { <ls_item>-booking_id } already exists|.
      ENDIF.
    ENDLOOP.

    copy_data_to_ref( EXPORTING is_data = ls_deep
                      CHANGING  cr_data = er_deep_entity ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_expanded_entityset.
* The fast path a hand-written DPC takes for $expand=to_Bookings: two
* SELECTs instead of one per travel, deep rows, and the tech clause that
* tells the framework this navigation is already filled.
    DATA lt_children TYPE /iwbep/if_mgw_odata_expand=>ty_t_node_children.
    DATA ls_child    LIKE LINE OF lt_children.
    DATA lt_travel   TYPE zcl_zstg_demo_mpc=>tt_travel.
    DATA lt_deep     TYPE STANDARD TABLE OF zcl_zstg_demo_mpc=>ts_travel_deep WITH DEFAULT KEY.
    DATA ls_deep     TYPE zcl_zstg_demo_mpc=>ts_travel_deep.
    DATA lt_booking  TYPE STANDARD TABLE OF zcl_zstg_demo_mpc=>ts_booking WITH DEFAULT KEY.
    DATA ls_travel   TYPE zcl_zstg_demo_mpc=>ts_travel.
    DATA ls_booking  TYPE zcl_zstg_demo_mpc=>ts_booking.
    DATA lv_wants    TYPE abap_bool.

    IF io_expand IS BOUND.
      lt_children = io_expand->get_children( ).
      LOOP AT lt_children INTO ls_child.
        IF to_upper( ls_child-tech_nav_prop_name ) = 'TO_BOOKINGS'.
          lv_wants = abap_true.
        ENDIF.
      ENDLOOP.
    ENDIF.

    IF iv_entity_set_name <> 'TravelSet' OR lv_wants = abap_false.
      super->/iwbep/if_mgw_appl_srv_runtime~get_expanded_entityset(
        EXPORTING
          iv_entity_name           = iv_entity_name
          iv_entity_set_name       = iv_entity_set_name
          iv_source_name           = iv_source_name
          it_filter_select_options = it_filter_select_options
          it_order                 = it_order
          is_paging                = is_paging
          it_navigation_path       = it_navigation_path
          it_key_tab               = it_key_tab
          iv_filter_string         = iv_filter_string
          iv_search_string         = iv_search_string
          io_expand                = io_expand
          io_tech_request_context  = io_tech_request_context
        IMPORTING
          er_entityset             = er_entityset
          et_expanded_tech_clauses = et_expanded_tech_clauses
          es_response_context      = es_response_context ).
      RETURN.
    ENDIF.

    travelset_get_entityset(
      EXPORTING
        iv_entity_name           = iv_entity_name
        iv_entity_set_name       = iv_entity_set_name
        iv_source_name           = iv_source_name
        it_filter_select_options = it_filter_select_options
        it_order                 = it_order
        is_paging                = is_paging
        it_navigation_path       = it_navigation_path
        it_key_tab               = it_key_tab
        iv_filter_string         = iv_filter_string
        iv_search_string         = iv_search_string
        io_tech_request_context  = io_tech_request_context
      IMPORTING
        et_entityset             = lt_travel
        es_response_context      = es_response_context ).

* an empty driving table would select every booking (ABAP semantics)
    IF lt_travel IS NOT INITIAL.
      SELECT * FROM zstg_demo_bk
        INTO CORRESPONDING FIELDS OF TABLE lt_booking
        FOR ALL ENTRIES IN lt_travel
        WHERE travel_id = lt_travel-travel_id.
      SORT lt_booking BY travel_id booking_id.
    ENDIF.

    LOOP AT lt_travel INTO ls_travel.
      CLEAR ls_deep.
      MOVE-CORRESPONDING ls_travel TO ls_deep.
      LOOP AT lt_booking INTO ls_booking WHERE travel_id = ls_travel-travel_id.
        APPEND ls_booking TO ls_deep-to_bookings.
      ENDLOOP.
      APPEND ls_deep TO lt_deep.
    ENDLOOP.

    APPEND 'TO_BOOKINGS' TO et_expanded_tech_clauses.
    copy_data_to_ref( EXPORTING is_data = lt_deep
                      CHANGING  cr_data = er_entityset ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    DATA ls_travel TYPE zcl_zstg_demo_mpc=>ts_travel.
    DATA lv_id     TYPE c LENGTH 8.
    DATA lv_status TYPE c LENGTH 1.
    DATA lv_count  TYPE i.

    CASE iv_action_name.
      WHEN 'CancelTravel'.
        lv_id = key_value( it_key_tab = it_parameter
                           iv_name    = 'TravelId' ).
        UPDATE zstg_demo SET status = 'X' WHERE travel_id = lv_id.
        IF sy-subrc <> 0.
          RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
            EXPORTING
              message = |Travel { lv_id } does not exist|.
        ENDIF.
        SELECT SINGLE travel_id description status seats
          FROM zstg_demo
          INTO CORRESPONDING FIELDS OF ls_travel
          WHERE travel_id = lv_id.
        copy_data_to_ref( EXPORTING is_data = ls_travel
                          CHANGING  cr_data = er_data ).
      WHEN 'TravelCount'.
        lv_status = key_value( it_key_tab = it_parameter
                               iv_name    = 'Status' ).
        IF lv_status IS INITIAL.
          SELECT COUNT( * ) FROM zstg_demo INTO lv_count.
        ELSE.
          SELECT COUNT( * ) FROM zstg_demo INTO lv_count WHERE status = lv_status.
        ENDIF.
        copy_data_to_ref( EXPORTING is_data = lv_count
                          CHANGING  cr_data = er_data ).
      WHEN OTHERS.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
          EXPORTING
            textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
            method = iv_action_name.
    ENDCASE.
  ENDMETHOD.

  METHOD key_value.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_key-value.
    ENDIF.
  ENDMETHOD.

  METHOD bookingset_get_entityset.
    DATA lt_travel_id TYPE ty_ranges.
    DATA ls_range     TYPE ty_range.
    DATA lv_parent    TYPE string.

    lt_travel_id = ranges_for( iv_property = 'TravelId'
                               it_filter   = it_filter_select_options ).

* navigation TravelSet('x')/to_Bookings: the source keys arrive in it_key_tab
    IF it_navigation_path IS NOT INITIAL.
      lv_parent = key_value( it_key_tab = it_key_tab
                             iv_name    = 'TravelId' ).
      IF lv_parent IS NOT INITIAL.
        ls_range-sign   = 'I'.
        ls_range-option = 'EQ'.
        ls_range-low    = lv_parent.
        APPEND ls_range TO lt_travel_id.
      ENDIF.
    ENDIF.

    SELECT travel_id booking_id customer flight_date
      FROM zstg_demo_bk
      INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE travel_id IN lt_travel_id
      ORDER BY travel_id booking_id.
  ENDMETHOD.

  METHOD bookingset_get_entity.
    DATA lv_travel_id  TYPE c LENGTH 8.
    DATA lv_booking_id TYPE c LENGTH 4.

    lv_travel_id  = key_value( it_key_tab = it_key_tab
                               iv_name    = 'TravelId' ).
    lv_booking_id = key_value( it_key_tab = it_key_tab
                               iv_name    = 'BookingId' ).

    SELECT SINGLE travel_id booking_id customer flight_date
      FROM zstg_demo_bk
      INTO CORRESPONDING FIELDS OF er_entity
      WHERE travel_id = lv_travel_id
        AND booking_id = lv_booking_id.
  ENDMETHOD.

  METHOD travelset_get_entity.
    DATA lv_travel_id TYPE c LENGTH 8.

    lv_travel_id = key_from( it_key_tab ).

    SELECT SINGLE travel_id description status seats
      FROM zstg_demo
      INTO CORRESPONDING FIELDS OF er_entity
      WHERE travel_id = lv_travel_id.
    IF sy-subrc = 0.
      SELECT SINGLE status_text FROM zstg_status
        INTO er_entity-status_text
        WHERE status = er_entity-status.
    ENDIF.
  ENDMETHOD.

  METHOD fill_status_text.
    DATA lt_status TYPE zcl_zstg_demo_mpc=>tt_status_vh.
    DATA ls_status LIKE LINE OF lt_status.
    FIELD-SYMBOLS <ls_travel> LIKE LINE OF ct_travel.

    IF ct_travel IS INITIAL.
      RETURN.
    ENDIF.
    SELECT status status_text FROM zstg_status
      INTO CORRESPONDING FIELDS OF TABLE lt_status.
    LOOP AT ct_travel ASSIGNING <ls_travel>.
      READ TABLE lt_status INTO ls_status WITH KEY status = <ls_travel>-status.
      IF sy-subrc = 0.
        <ls_travel>-status_text = ls_status-status_text.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD statusvhset_get_entityset.
* the F4 list: $filter on the code, $search over the text, the way the
* value help dialog asks for it
    DATA lt_status TYPE ty_ranges.
    DATA lv_search TYPE string.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF et_entityset.

    lt_status = ranges_for( iv_property = 'Status'
                            it_filter   = it_filter_select_options ).

    SELECT status status_text FROM zstg_status
      INTO CORRESPONDING FIELDS OF TABLE et_entityset
      WHERE status IN lt_status
      ORDER BY status.

    IF iv_search_string IS NOT INITIAL.
      lv_search = to_upper( iv_search_string ).
      LOOP AT et_entityset ASSIGNING <ls_row>.
        IF to_upper( <ls_row>-status_text ) NS lv_search AND to_upper( <ls_row>-status ) NS lv_search.
          DELETE et_entityset.
        ENDIF.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
