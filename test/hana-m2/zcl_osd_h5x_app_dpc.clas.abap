CLASS zcl_osd_h5x_app_dpc DEFINITION PUBLIC INHERITING FROM zcl_osd_h5x_dpc CREATE PUBLIC.
* What the read-only Fiori Elements app reads of the twin, beside the twin's
* own list read: a single partner (the object page) and the orders of a
* partner (its sub-list), written to the sample's contract -- on a
* navigation it_key_tab holds the SOURCE's keys by their OData names, and
* the DPC pages and counts what it returns. The partner list stays the
* twin's (super), so filter, sort, paging and the inline count the list
* report sends go through the read shape milestone 2 proved.
  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entityset REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entity REDEFINITION.
  PRIVATE SECTION.
    CLASS-METHODS key_value
      IMPORTING
        it_key_tab      TYPE /iwbep/t_mgw_name_value_pair
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS zcl_osd_h5x_app_dpc IMPLEMENTATION.
  METHOD key_value.
    DATA ls_key LIKE LINE OF it_key_tab.

    READ TABLE it_key_tab INTO ls_key WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_key-value.
    ENDIF.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.
    DATA ls_order    TYPE zcl_osd_h5x_mpc=>ts_order.
    DATA lt_orders   TYPE STANDARD TABLE OF zcl_osd_h5x_mpc=>ts_order WITH DEFAULT KEY.
    DATA lt_page     TYPE STANDARD TABLE OF zcl_osd_h5x_mpc=>ts_order WITH DEFAULT KEY.
    DATA lv_partner  TYPE c LENGTH 10.
    DATA lv_top      TYPE i.
    DATA lv_skip     TYPE i.
    DATA lv_count    TYPE i.

    IF iv_entity_set_name <> 'OrderSet'.
      super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(
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
          er_entityset             = er_entityset
          es_response_context      = es_response_context ).
      RETURN.
    ENDIF.

* the orders of one partner (PartnerSet('k')/ToOrders), or all of them.
* The source set from the technical context, as the twin itself reads it:
* this gateway passes iv_source_name empty on a navigation (a system names
* the source type there), and a DPC that asked it would answer every order
    IF io_tech_request_context IS BOUND
        AND io_tech_request_context->get_source_entity_set_name( ) IS NOT INITIAL.
      lv_partner = key_value( it_key_tab = it_key_tab
                              iv_name    = 'PartnerID' ).
      SELECT order_id partner_id FROM zosd_h5x_so
        INTO CORRESPONDING FIELDS OF TABLE lt_orders
        WHERE partner_id = lv_partner
        ORDER BY order_id.
    ELSE.
      SELECT order_id partner_id FROM zosd_h5x_so
        INTO CORRESPONDING FIELDS OF TABLE lt_orders
        ORDER BY order_id.
    ENDIF.

    lv_count = lines( lt_orders ).
    IF io_tech_request_context IS BOUND.
      IF io_tech_request_context->has_count( ) = abap_true.
        es_response_context-count = lv_count.
        RETURN.
      ENDIF.
      IF io_tech_request_context->has_inlinecount( ) = abap_true.
        es_response_context-inlinecount = lv_count.
      ENDIF.
      lv_top  = io_tech_request_context->get_top( ).
      lv_skip = io_tech_request_context->get_skip( ).
    ENDIF.

    LOOP AT lt_orders INTO ls_order.
      IF sy-tabix <= lv_skip.
        CONTINUE.
      ENDIF.
      IF lv_top > 0 AND lines( lt_page ) >= lv_top.
        EXIT.
      ENDIF.
      APPEND ls_order TO lt_page.
    ENDLOOP.

    copy_data_to_ref( EXPORTING is_data = lt_page
                      CHANGING  cr_data = er_entityset ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entity.
    DATA ls_entity  TYPE zcl_osd_h5x_mpc=>ts_partner.
    DATA ls_order   TYPE zcl_osd_h5x_mpc=>ts_order.
    DATA lv_partner TYPE c LENGTH 10.
    DATA lv_order   TYPE c LENGTH 10.

    CASE iv_entity_set_name.
      WHEN 'PartnerSet'.
        lv_partner = key_value( it_key_tab = it_key_tab
                                iv_name    = 'PartnerID' ).
        SELECT SINGLE b~partner_id b~name b~changed_at a~city a~country
          INTO (ls_entity-partner_id, ls_entity-name, ls_entity-changed_at,
                ls_entity-address-city, ls_entity-address-country)
          FROM ( zosd_h5x_bp AS b
                 INNER JOIN zosd_h5x_ad AS a ON a~node_key = b~addr_key )
          WHERE b~partner_id = lv_partner.
* not found: no entity, which the gateway answers 404
        IF sy-subrc <> 0.
          RETURN.
        ENDIF.
        copy_data_to_ref( EXPORTING is_data = ls_entity
                          CHANGING  cr_data = er_entity ).
      WHEN 'OrderSet'.
        lv_order = key_value( it_key_tab = it_key_tab
                              iv_name    = 'OrderID' ).
        SELECT SINGLE order_id partner_id FROM zosd_h5x_so
          INTO CORRESPONDING FIELDS OF ls_order
          WHERE order_id = lv_order.
* not found: no entity, which the gateway answers 404
        IF sy-subrc <> 0.
          RETURN.
        ENDIF.
        copy_data_to_ref( EXPORTING is_data = ls_order
                          CHANGING  cr_data = er_entity ).
    ENDCASE.
  ENDMETHOD.
ENDCLASS.
