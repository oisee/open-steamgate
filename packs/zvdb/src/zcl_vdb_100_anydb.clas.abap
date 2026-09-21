CLASS zcl_vdb_100_anydb DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_vdb_100_engine.
    CLASS-METHODS class_constructor.
  PRIVATE SECTION.
    TYPES tt_vector TYPE STANDARD TABLE OF zvdb_100_vec WITH EMPTY KEY.
    CLASS-DATA gt_popcount TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    CLASS-METHODS popcount IMPORTING ix_value TYPE xstring RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_vdb_100_anydb IMPLEMENTATION.
  METHOD class_constructor.
    DO 256 TIMES.
      DATA(lv_value) = sy-index - 1.
      DATA(lv_count) = 0.
      WHILE lv_value > 0.
        lv_count = lv_count + ( lv_value MOD 2 ).
        lv_value = lv_value DIV 2.
      ENDWHILE.
      APPEND lv_count TO gt_popcount.
    ENDDO.
  ENDMETHOD.

  METHOD popcount.
    DO xstrlen( ix_value ) TIMES.
      DATA(lv_offset) = sy-index - 1.
      DATA(lv_byte) = ix_value+lv_offset(1).
      rv_count = rv_count + gt_popcount[ CONV i( lv_byte ) + 1 ].
    ENDDO.
  ENDMETHOD.

  METHOD zif_vdb_100_engine~dot_product.
    IF iv_dims <= 0 OR iv_dims > zif_vdb_100_engine=>gc_max_dims OR iv_dims MOD 8 <> 0
      OR xstrlen( ix_v1 ) <> iv_dims DIV 8 OR xstrlen( ix_v2 ) <> iv_dims DIV 8.
      RAISE EXCEPTION TYPE cx_sy_conversion_error.
    ENDIF.
    DATA(lx_xor) = ix_v1 BIT-XOR ix_v2.
    rv_rank = iv_dims - 2 * popcount( CONV xstring( lx_xor ) ).
  ENDMETHOD.

  METHOD zif_vdb_100_engine~search.
    DATA lv_query_bits TYPE x LENGTH 192.
    DATA lx_query TYPE xstring.
    DATA lv_dims TYPE i.
    DATA lv_model TYPE c LENGTH 80.
    DATA lt_vector TYPE tt_vector.
    SELECT SINGLE qbits dims model FROM zvdb_100_vec INTO ( lv_query_bits, lv_dims, lv_model )
      WHERE mandt = sy-mandt AND bid = iv_bucket AND id = iv_query_id.
    IF sy-subrc <> 0 OR iv_top_k <= 0.
      RETURN.
    ENDIF.
    SELECT * FROM zvdb_100_vec INTO TABLE lt_vector
      WHERE mandt = sy-mandt AND bid = iv_bucket AND dims = lv_dims AND model = lv_model.
    DATA(lv_bytes) = lv_dims DIV 8.
    lx_query = CONV xstring( lv_query_bits ).
    lx_query = lx_query(lv_bytes).
    LOOP AT lt_vector INTO DATA(ls_vector).
      DATA(lx_candidate) = CONV xstring( ls_vector-qbits ).
      lx_candidate = lx_candidate(lv_bytes).
      APPEND VALUE #(
        query_id = iv_query_id result_id = ls_vector-id bid = ls_vector-bid
        payload = ls_vector-payload dims = lv_dims engine = 'ANYDB'
        rank = zif_vdb_100_engine~dot_product(
          ix_v1 = lx_query ix_v2 = lx_candidate
          iv_dims = lv_dims ) ) TO rt_result.
    ENDLOOP.
    SORT rt_result BY rank DESCENDING result_id ASCENDING.
    DATA(lv_index) = iv_top_k + 1.
    WHILE lines( rt_result ) >= lv_index.
      DELETE rt_result INDEX lv_index.
    ENDWHILE.
  ENDMETHOD.

  METHOD zif_vdb_100_engine~get_impl_type.
    rv_type = 'ANYDB'.
  ENDMETHOD.
ENDCLASS.
