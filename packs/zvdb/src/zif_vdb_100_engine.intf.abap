INTERFACE zif_vdb_100_engine PUBLIC.
  CONSTANTS gc_max_dims TYPE i VALUE 1536.
  TYPES ty_bucket TYPE c LENGTH 32.
  TYPES ty_id TYPE c LENGTH 32.
  TYPES ty_vector TYPE x LENGTH 32.
  TYPES: BEGIN OF ts_result,
           query_id TYPE c LENGTH 32,
           result_id TYPE c LENGTH 32,
           bid TYPE c LENGTH 32,
           payload TYPE c LENGTH 255,
           dims TYPE i,
           rank TYPE i,
           engine TYPE c LENGTH 8,
         END OF ts_result,
         tt_result TYPE STANDARD TABLE OF ts_result WITH EMPTY KEY.

  METHODS search
    IMPORTING iv_bucket TYPE ty_bucket
              iv_query_id TYPE ty_id
              iv_top_k TYPE i DEFAULT 10
    RETURNING VALUE(rt_result) TYPE tt_result.

  METHODS dot_product
    IMPORTING ix_v1 TYPE xstring
              ix_v2 TYPE xstring
              iv_dims TYPE i
    RETURNING VALUE(rv_rank) TYPE i.

  METHODS get_impl_type RETURNING VALUE(rv_type) TYPE string.
ENDINTERFACE.
