CLASS zcl_vdb_100_hana DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    INTERFACES zif_vdb_100_engine.
    TYPES: BEGIN OF ty_db_result,
             result_id TYPE c LENGTH 32,
             bid TYPE c LENGTH 32,
             payload TYPE c LENGTH 255,
             dims TYPE i,
             rank TYPE i,
           END OF ty_db_result,
           tt_db_result TYPE STANDARD TABLE OF ty_db_result WITH EMPTY KEY.
    CLASS-METHODS search_db
      IMPORTING VALUE(iv_client) TYPE string
                VALUE(iv_bucket) TYPE string
                VALUE(iv_query_id) TYPE string
                VALUE(iv_top_k) TYPE i
      EXPORTING VALUE(et_result) TYPE tt_db_result.
  PRIVATE SECTION.
    DATA mo_portable TYPE REF TO zif_vdb_100_engine.
ENDCLASS.

CLASS zcl_vdb_100_hana IMPLEMENTATION.
  METHOD search_db BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY USING zvdb_100_vec.
    et_result = SELECT v.id AS result_id,
                       v.bid AS bid,
                       v.payload AS payload,
                       v.dims AS dims,
                       v.dims - 2 * BITCOUNT(BITXOR(v.qbits, q.qbits)) AS rank
                  FROM zvdb_100_vec AS v
                  INNER JOIN zvdb_100_vec AS q
                    ON q.mandt = CAST(:iv_client AS NVARCHAR(3))
                   AND q.bid = CAST(:iv_bucket AS NVARCHAR(32))
                   AND q.id = CAST(:iv_query_id AS NVARCHAR(32))
                 WHERE v.mandt = CAST(:iv_client AS NVARCHAR(3))
                   AND v.bid = CAST(:iv_bucket AS NVARCHAR(32))
                   AND v.dims = q.dims
                   AND v.model = q.model
                 ORDER BY rank DESC, result_id ASC
                 LIMIT :iv_top_k;
  ENDMETHOD.

  METHOD zif_vdb_100_engine~search.
    DATA lt_db TYPE tt_db_result.
    DATA lv_client TYPE string.
    DATA lv_bucket TYPE string.
    DATA lv_query_id TYPE string.
    IF iv_top_k <= 0.
      RETURN.
    ENDIF.
    lv_client = sy-mandt.
    lv_bucket = iv_bucket.
    lv_query_id = iv_query_id.
    search_db( EXPORTING iv_client = lv_client iv_bucket = lv_bucket
                         iv_query_id = lv_query_id iv_top_k = iv_top_k
               IMPORTING et_result = lt_db ).
    DATA(lv_engine) = COND string( WHEN sy-dbsys = 'HDB' THEN 'HANA' ELSE 'AMDP' ).
    LOOP AT lt_db INTO DATA(ls_db).
      APPEND VALUE #( query_id = iv_query_id result_id = ls_db-result_id
        bid = ls_db-bid payload = ls_db-payload dims = ls_db-dims rank = ls_db-rank engine = lv_engine ) TO rt_result.
    ENDLOOP.
  ENDMETHOD.

  METHOD zif_vdb_100_engine~dot_product.
    IF mo_portable IS INITIAL.
      mo_portable = NEW zcl_vdb_100_anydb( ).
    ENDIF.
    rv_rank = mo_portable->dot_product( ix_v1 = ix_v1 ix_v2 = ix_v2 iv_dims = iv_dims ).
  ENDMETHOD.

  METHOD zif_vdb_100_engine~get_impl_type.
    rv_type = COND string( WHEN sy-dbsys = 'HDB' THEN 'HANA' ELSE 'AMDP' ).
  ENDMETHOD.
ENDCLASS.
