CLASS zcl_zvdb_100_dpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zvdb_100_dpc CREATE PUBLIC.
  PROTECTED SECTION.
    METHODS vectorset_get_entityset REDEFINITION.
    METHODS vectorset_get_entity REDEFINITION.
    METHODS vectorset_create_entity REDEFINITION.
    METHODS vectorset_update_entity REDEFINITION.
    METHODS vectorset_delete_entity REDEFINITION.
    METHODS searchresultset_get_entityset REDEFINITION.
  PRIVATE SECTION.
    TYPES tt_vector TYPE STANDARD TABLE OF zvdb_100_vec WITH EMPTY KEY.
    METHODS key_value
      IMPORTING it_key_tab TYPE /iwbep/t_mgw_name_value_pair iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    METHODS filter_value
      IMPORTING it_filter TYPE /iwbep/t_mgw_select_option iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    METHODS filter_pattern
      IMPORTING it_filter TYPE /iwbep/t_mgw_select_option iv_name TYPE string
      RETURNING VALUE(rv_pattern) TYPE string.
    METHODS validate_vector
      IMPORTING is_vector TYPE zcl_zvdb_100_mpc=>ts_vector
      RAISING /iwbep/cx_mgw_busi_exception.
    METHODS to_entity
      IMPORTING is_db TYPE zvdb_100_vec
      RETURNING VALUE(rs_entity) TYPE zcl_zvdb_100_mpc=>ts_vector.
ENDCLASS.

CLASS zcl_zvdb_100_dpc_ext IMPLEMENTATION.
  METHOD key_value.
    DATA ls_key TYPE /iwbep/s_mgw_name_value_pair.
    READ TABLE it_key_tab INTO ls_key WITH KEY name = iv_name.
    IF sy-subrc = 0.
      rv_value = ls_key-value.
    ENDIF.
  ENDMETHOD.

  METHOD filter_value.
    LOOP AT it_filter INTO DATA(ls_filter).
      IF to_upper( ls_filter-property ) = to_upper( iv_name ).
        READ TABLE ls_filter-select_options INDEX 1 INTO DATA(ls_option).
        IF sy-subrc = 0 AND ls_option-sign = 'I' AND ls_option-option = 'EQ'.
          rv_value = ls_option-low.
        ENDIF.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD filter_pattern.
    LOOP AT it_filter INTO DATA(ls_filter).
      IF to_upper( ls_filter-property ) = to_upper( iv_name ).
        READ TABLE ls_filter-select_options INDEX 1 INTO DATA(ls_option).
        IF sy-subrc = 0 AND ls_option-sign = 'I' AND ls_option-option = 'CP'.
          rv_pattern = ls_option-low.
        ENDIF.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validate_vector.
    DATA(lv_hex) = to_upper( is_vector-qbits ).
    IF is_vector-bid IS INITIAL OR is_vector-id IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Bucket and vector ID are required'.
    ENDIF.
    IF is_vector-dims <= 0 OR is_vector-dims > zif_vdb_100_engine=>gc_max_dims
      OR is_vector-dims MOD 8 <> 0
      OR strlen( lv_hex ) <> is_vector-dims DIV 4
      OR lv_hex CN '0123456789ABCDEF'.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Dimensions must be 8..1536 by 8 and VectorHex must carry exactly one bit per dimension'.
    ENDIF.
    IF strlen( is_vector-bid ) > 32 OR strlen( is_vector-id ) > 32
      OR strlen( is_vector-payload ) > 255 OR strlen( is_vector-model ) > 64
      OR is_vector-model IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Bucket/ID/payload/model exceeds its limit, or model is empty'.
    ENDIF.
  ENDMETHOD.

  METHOD to_entity.
    rs_entity-bid = is_db-bid.
    rs_entity-id = is_db-id.
    rs_entity-dims = is_db-dims.
    DATA(lv_hex) = CONV string( is_db-qbits ).
    DATA(lv_chars) = is_db-dims DIV 4.
    rs_entity-qbits = lv_hex+0(lv_chars).
    rs_entity-payload = is_db-payload.
    rs_entity-model = is_db-model.
  ENDMETHOD.

  METHOD vectorset_get_entityset.
    DATA(lv_filter_bucket) = to_upper( filter_value( it_filter = it_filter_select_options iv_name = 'Bucket' ) ).
    DATA(lv_filter_id) = to_upper( filter_value( it_filter = it_filter_select_options iv_name = 'Id' ) ).
    DATA(lv_filter_payload) = to_upper( filter_pattern( it_filter = it_filter_select_options iv_name = 'Payload' ) ).
    DATA lt_db TYPE tt_vector.
    SELECT * FROM zvdb_100_vec INTO TABLE lt_db WHERE mandt = sy-mandt ORDER BY bid id.
    LOOP AT lt_db INTO DATA(ls_db).
      IF ( lv_filter_bucket IS NOT INITIAL AND ls_db-bid <> lv_filter_bucket )
        OR ( lv_filter_id IS NOT INITIAL AND ls_db-id <> lv_filter_id )
        OR ( lv_filter_payload IS NOT INITIAL AND to_upper( ls_db-payload ) NP lv_filter_payload ).
        CONTINUE.
      ENDIF.
      APPEND to_entity( ls_db ) TO et_entityset.
    ENDLOOP.
    IF iv_search_string IS NOT INITIAL.
      DATA(lv_search) = to_upper( iv_search_string ).
      LOOP AT et_entityset ASSIGNING FIELD-SYMBOL(<ls_vector>).
        IF to_upper( <ls_vector>-bid ) NS lv_search
          AND to_upper( <ls_vector>-id ) NS lv_search
          AND to_upper( <ls_vector>-payload ) NS lv_search.
          DELETE et_entityset.
        ENDIF.
      ENDLOOP.
    ENDIF.
    DATA(lv_skip) = is_paging-skip.
    DO lv_skip TIMES.
      DELETE et_entityset INDEX 1.
    ENDDO.
    IF is_paging-top > 0.
      DATA(lv_index) = is_paging-top + 1.
      WHILE lines( et_entityset ) >= lv_index.
        DELETE et_entityset INDEX lv_index.
      ENDWHILE.
    ENDIF.
  ENDMETHOD.

  METHOD vectorset_get_entity.
    DATA(lv_bucket) = key_value( it_key_tab = it_key_tab iv_name = 'Bucket' ).
    DATA(lv_id) = key_value( it_key_tab = it_key_tab iv_name = 'Id' ).
    SELECT SINGLE * FROM zvdb_100_vec INTO @DATA(ls_db)
      WHERE mandt = @sy-mandt AND bid = @lv_bucket AND id = @lv_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = |Vector { lv_bucket }/{ lv_id } does not exist|.
    ENDIF.
    er_entity = to_entity( ls_db ).
  ENDMETHOD.

  METHOD vectorset_create_entity.
    DATA ls_db TYPE zvdb_100_vec.
    io_data_provider->read_entry_data( IMPORTING es_data = er_entity ).
    er_entity-bid = to_upper( er_entity-bid ).
    er_entity-id = to_upper( er_entity-id ).
    er_entity-qbits = to_upper( er_entity-qbits ).
    validate_vector( er_entity ).
    ls_db-mandt = sy-mandt.
    ls_db-bid = er_entity-bid.
    ls_db-id = er_entity-id.
    SELECT SINGLE dims model FROM zvdb_100_vec INTO (@DATA(lv_bucket_dims), @DATA(lv_bucket_model))
      WHERE mandt = @sy-mandt AND bid = @er_entity-bid.
    IF sy-subrc = 0 AND ( lv_bucket_dims <> er_entity-dims OR lv_bucket_model <> er_entity-model ).
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Every vector in a bucket must use the same dimensions and model'.
    ENDIF.
    ls_db-dims = er_entity-dims.
    ls_db-qbits = er_entity-qbits.
    ls_db-payload = er_entity-payload.
    ls_db-model = er_entity-model.
    INSERT zvdb_100_vec FROM ls_db.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = |Vector { er_entity-bid }/{ er_entity-id } already exists|.
    ENDIF.
  ENDMETHOD.

  METHOD vectorset_update_entity.
    DATA(lv_url_bucket) = to_upper( key_value( it_key_tab = it_key_tab iv_name = 'Bucket' ) ).
    DATA(lv_url_id) = to_upper( key_value( it_key_tab = it_key_tab iv_name = 'Id' ) ).
    io_data_provider->read_entry_data( IMPORTING es_data = er_entity ).
    er_entity-bid = to_upper( er_entity-bid ).
    er_entity-id = to_upper( er_entity-id ).
    er_entity-qbits = to_upper( er_entity-qbits ).
    validate_vector( er_entity ).
    IF er_entity-bid <> lv_url_bucket OR er_entity-id <> lv_url_id.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Bucket and ID in the payload must match the resource URL'.
    ENDIF.
    SELECT SINGLE dims model FROM zvdb_100_vec INTO (@DATA(lv_old_dims), @DATA(lv_old_model))
      WHERE mandt = @sy-mandt AND bid = @lv_url_bucket AND id = @lv_url_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Vector does not exist'.
    ENDIF.
    IF er_entity-dims <> lv_old_dims OR er_entity-model <> lv_old_model.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Dimensions and model of an existing vector cannot be changed'.
    ENDIF.
    UPDATE zvdb_100_vec SET qbits = er_entity-qbits payload = er_entity-payload
      WHERE mandt = sy-mandt AND bid = lv_url_bucket AND id = lv_url_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Vector does not exist'.
    ENDIF.
  ENDMETHOD.

  METHOD vectorset_delete_entity.
    DATA(lv_bucket) = key_value( it_key_tab = it_key_tab iv_name = 'Bucket' ).
    DATA(lv_id) = key_value( it_key_tab = it_key_tab iv_name = 'Id' ).
    DELETE FROM zvdb_100_vec WHERE mandt = sy-mandt AND bid = lv_bucket AND id = lv_id.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Vector does not exist'.
    ENDIF.
  ENDMETHOD.

  METHOD searchresultset_get_entityset.
    DATA(lv_bucket) = to_upper( filter_value( it_filter = it_filter_select_options iv_name = 'Bucket' ) ).
    DATA(lv_query_id) = to_upper( filter_value( it_filter = it_filter_select_options iv_name = 'QueryId' ) ).
    DATA(lv_engine) = to_upper( filter_value( it_filter = it_filter_select_options iv_name = 'Engine' ) ).
    DATA(lv_top_k) = is_paging-top.
    IF lv_top_k <= 0.
      lv_top_k = 10.
    ENDIF.
    IF lv_bucket IS INITIAL OR lv_query_id IS INITIAL OR lv_top_k > 100
      OR ( lv_engine IS NOT INITIAL AND lv_engine <> 'ANYDB' AND lv_engine <> 'HANA'
           AND lv_engine <> 'AMDP' ).
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = 'Search requires EQ Bucket/QueryId, optional Engine ANYDB/AMDP/HANA, and $top 1..100'.
    ENDIF.
    DATA(lo_engine) = zcl_vdb_100_factory=>create( iv_mode = lv_engine ).
    DATA(lt_result) = lo_engine->search(
      iv_bucket = CONV zif_vdb_100_engine=>ty_bucket( lv_bucket )
      iv_query_id = CONV zif_vdb_100_engine=>ty_id( lv_query_id ) iv_top_k = lv_top_k ).
    IF lt_result IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING message = |No query vector { lv_bucket }/{ lv_query_id }|.
    ENDIF.
    LOOP AT lt_result INTO DATA(ls_result).
      APPEND CORRESPONDING #( ls_result ) TO et_entityset.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
