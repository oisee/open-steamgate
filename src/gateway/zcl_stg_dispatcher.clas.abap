CLASS zcl_stg_dispatcher DEFINITION PUBLIC CREATE PUBLIC.
* HTTP verb + OData URL -> the right DPC call -> OData v2 response.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_response,
             status       TYPE i,
             reason       TYPE string,
             content_type TYPE string,
             body         TYPE string,
             headers      TYPE tihttpnvp,
           END OF ty_response.

    CLASS-METHODS dispatch
      IMPORTING
        iv_method          TYPE string
        iv_path            TYPE string
        it_options         TYPE tihttpnvp OPTIONAL
        iv_host            TYPE string DEFAULT 'localhost'
        iv_body            TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE ty_response.
  PRIVATE SECTION.
    CLASS-METHODS run
      IMPORTING
        iv_method          TYPE string
        iv_path            TYPE string
        it_options         TYPE tihttpnvp
        iv_host            TYPE string
        iv_body            TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response
      RAISING
        zcx_stg_error
        /iwbep/cx_mgw_base_exception.

    CLASS-METHODS build_context
      IMPORTING
        is_request        TYPE zcl_stg_url=>ty_request
        is_set            TYPE zcl_stg_model_info=>ty_entity_set
      RETURNING
        VALUE(ro_context) TYPE REF TO zcl_stg_request_context
      RAISING
        zcx_stg_error.

    CLASS-METHODS parse_orderby
      IMPORTING
        iv_orderby      TYPE string
      RETURNING
        VALUE(rt_order) TYPE /iwbep/t_mgw_tech_order.

    CLASS-METHODS read_entity_set
      IMPORTING
        is_service         TYPE zcl_stg_model_info=>ty_service
        is_set             TYPE zcl_stg_model_info=>ty_entity_set
        is_request         TYPE zcl_stg_url=>ty_request
        iv_base_url        TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response
      RAISING
        zcx_stg_error
        /iwbep/cx_mgw_base_exception.

    CLASS-METHODS read_entity
      IMPORTING
        is_service         TYPE zcl_stg_model_info=>ty_service
        is_set             TYPE zcl_stg_model_info=>ty_entity_set
        is_request         TYPE zcl_stg_url=>ty_request
        iv_base_url        TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response
      RAISING
        zcx_stg_error
        /iwbep/cx_mgw_base_exception.

    CLASS-METHODS write_entity
      IMPORTING
        iv_method          TYPE string
        is_service         TYPE zcl_stg_model_info=>ty_service
        is_set             TYPE zcl_stg_model_info=>ty_entity_set
        is_request         TYPE zcl_stg_url=>ty_request
        iv_base_url        TYPE string
        iv_body            TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response
      RAISING
        zcx_stg_error
        /iwbep/cx_mgw_base_exception.

    CLASS-METHODS service_document
      IMPORTING
        is_service         TYPE zcl_stg_model_info=>ty_service
        iv_base_url        TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response.

    CLASS-METHODS json_response
      IMPORTING
        iv_status          TYPE i
        iv_body            TYPE string
      RETURNING
        VALUE(rs_response) TYPE ty_response.
ENDCLASS.

CLASS zcl_stg_dispatcher IMPLEMENTATION.

  METHOD dispatch.
    DATA lx_stg     TYPE REF TO zcx_stg_error.
    DATA lx_not     TYPE REF TO /iwbep/cx_mgw_not_impl_exc.
    DATA lx_busi    TYPE REF TO /iwbep/cx_mgw_busi_exception.
    DATA lx_gateway TYPE REF TO /iwbep/cx_mgw_base_exception.
    DATA lv_message TYPE string.

    TRY.
        rs_response = run( iv_method  = iv_method
                           iv_path    = iv_path
                           it_options = it_options
                           iv_host    = iv_host
                           iv_body    = iv_body ).
      CATCH zcx_stg_error INTO lx_stg.
        rs_response = json_response( iv_status = lx_stg->status
                                     iv_body   = zcl_stg_json=>error( iv_code    = lx_stg->code
                                                                      iv_message = lx_stg->message ) ).
      CATCH /iwbep/cx_mgw_not_impl_exc INTO lx_not.
        rs_response = json_response( iv_status = 501
                                     iv_body   = zcl_stg_json=>error( iv_code    = 'STG/NOT_IMPLEMENTED'
                                                                      iv_message = |DPC method not implemented: { lx_not->method }| ) ).
      CATCH /iwbep/cx_mgw_busi_exception INTO lx_busi.
        lv_message = lx_busi->message_unlimited.
        IF lv_message IS INITIAL.
          lv_message = lx_busi->message.
        ENDIF.
        IF lv_message IS INITIAL.
          lv_message = 'Business exception raised by the data provider'.
        ENDIF.
        rs_response = json_response( iv_status = 400
                                     iv_body   = zcl_stg_json=>error( iv_code    = 'STG/BUSINESS'
                                                                      iv_message = lv_message ) ).
      CATCH /iwbep/cx_mgw_base_exception INTO lx_gateway.
        rs_response = json_response( iv_status = 500
                                     iv_body   = zcl_stg_json=>error( iv_code    = 'STG/TECHNICAL'
                                                                      iv_message = lx_gateway->get_text( ) ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD json_response.
    rs_response-status       = iv_status.
    rs_response-content_type = 'application/json'.
    rs_response-body         = iv_body.
    CASE iv_status.
      WHEN 200.
        rs_response-reason = 'OK'.
      WHEN 201.
        rs_response-reason = 'Created'.
      WHEN 204.
        rs_response-reason = 'No Content'.
        CLEAR rs_response-content_type.
      WHEN 400.
        rs_response-reason = 'Bad Request'.
      WHEN 404.
        rs_response-reason = 'Not Found'.
      WHEN 405.
        rs_response-reason = 'Method Not Allowed'.
      WHEN 501.
        rs_response-reason = 'Not Implemented'.
      WHEN OTHERS.
        rs_response-reason = 'Error'.
    ENDCASE.
  ENDMETHOD.

  METHOD run.
    DATA ls_request TYPE zcl_stg_url=>ty_request.
    DATA ls_service TYPE zcl_stg_model_info=>ty_service.
    DATA ls_set     TYPE zcl_stg_model_info=>ty_entity_set.
    DATA lv_base    TYPE string.
    DATA lv_method  TYPE string.

    ls_request = zcl_stg_url=>parse( iv_path    = iv_path
                                     it_options = it_options ).
    ls_service = zcl_stg_model_info=>get( ls_request-service ).
    lv_base    = |http://{ iv_host }/sap/opu/odata/sap/{ ls_service-name }|.
    lv_method  = to_upper( iv_method ).

    IF ls_request-is_metadata = abap_true.
      rs_response-status       = 200.
      rs_response-reason       = 'OK'.
      rs_response-content_type = 'application/xml'.
      rs_response-body         = zcl_oao_http_handler=>handle( iv_path )-data.
      RETURN.
    ENDIF.

    IF ls_request-is_service_root = abap_true.
      rs_response = service_document( is_service  = ls_service
                                      iv_base_url = lv_base ).
      RETURN.
    ENDIF.

    ls_set = zcl_stg_model_info=>find_set( is_service    = ls_service
                                           iv_entity_set = ls_request-entity_set ).

    IF lv_method <> 'GET'.
      rs_response = write_entity( iv_method   = lv_method
                                  is_service  = ls_service
                                  is_set      = ls_set
                                  is_request  = ls_request
                                  iv_base_url = lv_base
                                  iv_body     = iv_body ).
      RETURN.
    ENDIF.

    IF ls_request-key_string IS INITIAL.
      rs_response = read_entity_set( is_service  = ls_service
                                     is_set      = ls_set
                                     is_request  = ls_request
                                     iv_base_url = lv_base ).
    ELSE.
      rs_response = read_entity( is_service  = ls_service
                                 is_set      = ls_set
                                 is_request  = ls_request
                                 iv_base_url = lv_base ).
    ENDIF.
  ENDMETHOD.

  METHOD write_entity.
    DATA lo_dpc      TYPE REF TO /iwbep/if_mgw_appl_srv_runtime.
    DATA lo_context  TYPE REF TO zcl_stg_request_context.
    DATA lo_provider TYPE REF TO zcl_stg_entry_provider.
    DATA lt_nav_path TYPE /iwbep/t_mgw_navigation_path.
    DATA lr_entity   TYPE REF TO data.
    DATA ls_header   TYPE ihttpnvp.
    FIELD-SYMBOLS <ls_data> TYPE any.

    lo_dpc     = zcl_oao_registry=>create_dpc( is_service-name ).
    lo_context = build_context( is_request = is_request
                                is_set     = is_set ).

    CASE iv_method.
      WHEN 'POST'.
        IF is_request-key_string IS NOT INITIAL.
          RAISE EXCEPTION TYPE zcx_stg_error
            EXPORTING
              status  = 405
              code    = 'STG/METHOD_NOT_ALLOWED'
              message = 'POST goes to the entity set, not to an entity'.
        ENDIF.
        CREATE OBJECT lo_provider
          EXPORTING
            it_values = zcl_stg_json=>parse_object( iv_body )
            is_set    = is_set.
        lo_dpc->create_entity(
          EXPORTING
            iv_entity_name          = is_set-entity_type
            iv_entity_set_name      = is_set-name
            iv_source_name          = ''
            io_data_provider        = lo_provider
            it_key_tab              = lo_context->mt_key_tab
            it_navigation_path      = lt_nav_path
            io_tech_request_context = lo_context
          IMPORTING
            er_entity               = lr_entity ).
        IF lr_entity IS NOT BOUND.
          RAISE EXCEPTION TYPE zcx_stg_error
            EXPORTING
              status  = 500
              code    = 'STG/NO_ENTITY'
              message = 'The data provider created nothing'.
        ENDIF.
        ASSIGN lr_entity->* TO <ls_data>.
        rs_response = json_response( iv_status = 201
                                     iv_body   = zcl_stg_json=>entry( is_data      = <ls_data>
                                                                      is_set       = is_set
                                                                      iv_namespace = is_service-namespace
                                                                      iv_base_url  = iv_base_url ) ).
        ls_header-name  = 'location'.
        ls_header-value = |{ iv_base_url }/{ is_set-name }({ zcl_stg_json=>key_predicate( is_data = <ls_data> is_set = is_set ) })|.
        APPEND ls_header TO rs_response-headers.

      WHEN 'PUT' OR 'PATCH' OR 'MERGE'.
        IF is_request-key_string IS INITIAL.
          RAISE EXCEPTION TYPE zcx_stg_error
            EXPORTING
              status  = 405
              code    = 'STG/METHOD_NOT_ALLOWED'
              message = |{ iv_method } needs an entity key|.
        ENDIF.
        CREATE OBJECT lo_provider
          EXPORTING
            it_values = zcl_stg_json=>parse_object( iv_body )
            is_set    = is_set.
        lo_dpc->update_entity(
          EXPORTING
            iv_entity_name          = is_set-entity_type
            iv_entity_set_name      = is_set-name
            iv_source_name          = ''
            io_data_provider        = lo_provider
            it_key_tab              = lo_context->mt_key_tab
            it_navigation_path      = lt_nav_path
            io_tech_request_context = lo_context
          IMPORTING
            er_entity               = lr_entity ).
        rs_response = json_response( iv_status = 204
                                     iv_body   = '' ).

      WHEN 'DELETE'.
        IF is_request-key_string IS INITIAL.
          RAISE EXCEPTION TYPE zcx_stg_error
            EXPORTING
              status  = 405
              code    = 'STG/METHOD_NOT_ALLOWED'
              message = 'DELETE needs an entity key'.
        ENDIF.
        lo_dpc->delete_entity(
          iv_entity_name          = is_set-entity_type
          iv_entity_set_name      = is_set-name
          iv_source_name          = ''
          it_key_tab              = lo_context->mt_key_tab
          it_navigation_path      = lt_nav_path
          io_tech_request_context = lo_context ).
        rs_response = json_response( iv_status = 204
                                     iv_body   = '' ).

      WHEN OTHERS.
        RAISE EXCEPTION TYPE zcx_stg_error
          EXPORTING
            status  = 501
            code    = 'STG/VERB_NOT_IMPLEMENTED'
            message = |{ iv_method } is not implemented|.
    ENDCASE.
  ENDMETHOD.

  METHOD service_document.
    DATA ls_set  LIKE LINE OF is_service-entity_sets.
    DATA lv_sets TYPE string.

    LOOP AT is_service-entity_sets INTO ls_set.
      IF lv_sets IS INITIAL.
        lv_sets = |"{ ls_set-name }"|.
      ELSE.
        lv_sets = |{ lv_sets },"{ ls_set-name }"|.
      ENDIF.
    ENDLOOP.
    rs_response = json_response( iv_status = 200
                                 iv_body   = |\{"d":\{"EntitySets":[{ lv_sets }]\}\}| ).
  ENDMETHOD.

  METHOD parse_orderby.
    DATA lt_parts TYPE string_table.
    DATA lv_part  TYPE string.
    DATA ls_order TYPE /iwbep/s_mgw_tech_order.
    DATA lv_dir   TYPE string.

    SPLIT iv_orderby AT ',' INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      CONDENSE lv_part.
      IF lv_part IS INITIAL.
        CONTINUE.
      ENDIF.
      CLEAR ls_order.
      SPLIT lv_part AT space INTO ls_order-property lv_dir.
      CONDENSE lv_dir.
      IF to_lower( lv_dir ) = 'desc'.
        ls_order-order = 'desc'.
      ELSE.
        ls_order-order = 'asc'.
      ENDIF.
      ls_order-property_path = ls_order-property.
      APPEND ls_order TO rt_order.
    ENDLOOP.
  ENDMETHOD.

  METHOD build_context.
    DATA lv_value TYPE string.

    CREATE OBJECT ro_context.
    ro_context->mv_entity_set  = is_set-name.
    ro_context->mv_entity_type = is_set-entity_type.
    ro_context->ms_set         = is_set.
    ro_context->mv_count       = is_request-is_count.

    lv_value = zcl_stg_url=>option( is_request = is_request
                                    iv_name    = '$top' ).
    IF lv_value IS NOT INITIAL.
      ro_context->mv_top = lv_value.
    ENDIF.

    lv_value = zcl_stg_url=>option( is_request = is_request
                                    iv_name    = '$skip' ).
    IF lv_value IS NOT INITIAL.
      ro_context->mv_skip = lv_value.
    ENDIF.

    lv_value = zcl_stg_url=>option( is_request = is_request
                                    iv_name    = '$inlinecount' ).
    IF to_lower( lv_value ) = 'allpages'.
      ro_context->mv_inlinecount = abap_true.
    ENDIF.

    lv_value = zcl_stg_url=>option( is_request = is_request
                                    iv_name    = '$orderby' ).
    IF lv_value IS NOT INITIAL.
      ro_context->mt_orderby = parse_orderby( lv_value ).
    ENDIF.

    lv_value = zcl_stg_url=>option( is_request = is_request
                                    iv_name    = '$filter' ).
    IF lv_value IS NOT INITIAL.
      ro_context->mv_filter_string = lv_value.
      ro_context->mt_filter = zcl_stg_filter=>parse( iv_filter = lv_value
                                                     is_set    = is_set ).
    ENDIF.

    ro_context->mt_key_tab = zcl_stg_url=>parse_keys(
      iv_key_string = is_request-key_string
      it_key_names  = zcl_stg_model_info=>key_names( is_set ) ).
  ENDMETHOD.

  METHOD read_entity_set.
    DATA lo_dpc       TYPE REF TO /iwbep/if_mgw_appl_srv_runtime.
    DATA lo_context   TYPE REF TO zcl_stg_request_context.
    DATA lt_nav_path  TYPE /iwbep/t_mgw_navigation_path.
    DATA ls_paging    TYPE /iwbep/s_mgw_paging.
    DATA lr_entityset TYPE REF TO data.
    DATA ls_context   TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_context.
    DATA lv_count     TYPE string.
    FIELD-SYMBOLS <lt_data> TYPE ANY TABLE.

    lo_dpc     = zcl_oao_registry=>create_dpc( is_service-name ).
    lo_context = build_context( is_request = is_request
                                is_set     = is_set ).
    IF is_request-is_count = abap_false.
      ls_paging = lo_context->get_paging( ).
    ENDIF.

    lo_dpc->get_entityset(
      EXPORTING
        iv_entity_name           = is_set-entity_type
        iv_entity_set_name       = is_set-name
        iv_source_name           = ''
        it_filter_select_options = lo_context->mt_filter
        is_paging                = ls_paging
        it_key_tab               = lo_context->mt_key_tab
        it_navigation_path       = lt_nav_path
        it_order                 = lo_context->get_sorting_order( )
        iv_filter_string         = lo_context->mv_filter_string
        iv_search_string         = ''
        io_tech_request_context  = lo_context
      IMPORTING
        er_entityset             = lr_entityset
        es_response_context      = ls_context ).

    IF lr_entityset IS BOUND.
      ASSIGN lr_entityset->* TO <lt_data>.
    ENDIF.

    IF is_request-is_count = abap_true.
      IF <lt_data> IS ASSIGNED.
        lv_count = |{ lines( <lt_data> ) }|.
      ELSE.
        lv_count = '0'.
      ENDIF.
      CONDENSE lv_count NO-GAPS.
      rs_response-status       = 200.
      rs_response-reason       = 'OK'.
      rs_response-content_type = 'text/plain'.
      rs_response-body         = lv_count.
      RETURN.
    ENDIF.

    IF lo_context->mv_inlinecount = abap_true.
      lv_count = ls_context-inlinecount.
      IF lv_count IS INITIAL AND <lt_data> IS ASSIGNED.
* the DPC did not count for us: count what it returned
        lv_count = |{ lines( <lt_data> ) }|.
        CONDENSE lv_count NO-GAPS.
      ENDIF.
    ENDIF.

    IF <lt_data> IS ASSIGNED.
      rs_response = json_response( iv_status = 200
                                   iv_body   = zcl_stg_json=>feed( it_data        = <lt_data>
                                                                   is_set         = is_set
                                                                   iv_namespace   = is_service-namespace
                                                                   iv_base_url    = iv_base_url
                                                                   iv_inlinecount = lv_count ) ).
    ELSE.
      rs_response = json_response( iv_status = 200
                                   iv_body   = '{"d":{"results":[]}}' ).
    ENDIF.
  ENDMETHOD.

  METHOD read_entity.
    DATA lo_dpc      TYPE REF TO /iwbep/if_mgw_appl_srv_runtime.
    DATA lo_context  TYPE REF TO zcl_stg_request_context.
    DATA lt_nav_path TYPE /iwbep/t_mgw_navigation_path.
    DATA lr_entity   TYPE REF TO data.
    FIELD-SYMBOLS <ls_data> TYPE any.

    lo_dpc     = zcl_oao_registry=>create_dpc( is_service-name ).
    lo_context = build_context( is_request = is_request
                                is_set     = is_set ).

    lo_dpc->get_entity(
      EXPORTING
        iv_entity_name          = is_set-entity_type
        iv_entity_set_name      = is_set-name
        iv_source_name          = ''
        it_key_tab              = lo_context->mt_key_tab
        it_navigation_path      = lt_nav_path
        io_tech_request_context = lo_context
      IMPORTING
        er_entity               = lr_entity ).

    IF lr_entity IS NOT BOUND.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 404
          code    = 'STG/ENTITY_NOT_FOUND'
          message = |{ is_set-name }({ is_request-key_string }) not found|.
    ENDIF.
    ASSIGN lr_entity->* TO <ls_data>.

    rs_response = json_response( iv_status = 200
                                 iv_body   = zcl_stg_json=>entry( is_data      = <ls_data>
                                                                  is_set       = is_set
                                                                  iv_namespace = is_service-namespace
                                                                  iv_base_url  = iv_base_url ) ).
  ENDMETHOD.

ENDCLASS.
