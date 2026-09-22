CLASS ltcl_rank DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS identical FOR TESTING.
    METHODS opposite FOR TESTING.
    METHODS one_bit FOR TESTING.
    METHODS portable_amdp_matches_anydb FOR TESTING.
ENDCLASS.

CLASS ltcl_rank IMPLEMENTATION.
  METHOD identical.
    DATA lo_engine TYPE REF TO zif_vdb_100_engine.
    lo_engine = NEW zcl_vdb_100_anydb( ).
    DATA(lx_vector) = CONV xstring( 'AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55AA55' ).
    cl_abap_unit_assert=>assert_equals( exp = 256 act = lo_engine->dot_product( ix_v1 = lx_vector ix_v2 = lx_vector iv_dims = 256 ) ).
  ENDMETHOD.
  METHOD opposite.
    DATA lo_engine TYPE REF TO zif_vdb_100_engine.
    lo_engine = NEW zcl_vdb_100_anydb( ).
    DATA(lx_zero) = CONV xstring( '0000000000000000000000000000000000000000000000000000000000000000' ).
    DATA(lx_one) = CONV xstring( 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' ).
    cl_abap_unit_assert=>assert_equals( exp = -256 act = lo_engine->dot_product( ix_v1 = lx_zero ix_v2 = lx_one iv_dims = 256 ) ).
  ENDMETHOD.
  METHOD one_bit.
    DATA lo_engine TYPE REF TO zif_vdb_100_engine.
    lo_engine = NEW zcl_vdb_100_anydb( ).
    DATA(lx_zero) = CONV xstring( '0000000000000000000000000000000000000000000000000000000000000000' ).
    DATA(lx_one) = CONV xstring( '0100000000000000000000000000000000000000000000000000000000000000' ).
    cl_abap_unit_assert=>assert_equals( exp = 254 act = lo_engine->dot_product( ix_v1 = lx_zero ix_v2 = lx_one iv_dims = 256 ) ).
  ENDMETHOD.

  METHOD portable_amdp_matches_anydb.
    DATA lo_anydb TYPE REF TO zif_vdb_100_engine.
    DATA lo_amdp TYPE REF TO zif_vdb_100_engine.

*   On DuckDB, constructing the HANA implementation still calls the original
*   SEARCH_DB AMDP.  The AMDP destination chooses its compiled portable IR;
*   no HANA connection and no JavaScript row loop is involved.
    IF sy-dbsys <> 'duckdb'.
      RETURN.
    ENDIF.
    lo_anydb = NEW zcl_vdb_100_anydb( ).
    lo_amdp = NEW zcl_vdb_100_hana( ).
    DATA(lt_anydb) = lo_anydb->search(
      iv_bucket = 'EGEMMA768' iv_query_id = 'I01P01L1' iv_top_k = 7 ).
    DATA(lt_amdp) = lo_amdp->search(
      iv_bucket = 'EGEMMA768' iv_query_id = 'I01P01L1' iv_top_k = 7 ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_amdp ) exp = lines( lt_anydb ) ).
    LOOP AT lt_anydb INTO DATA(ls_anydb).
      READ TABLE lt_amdp INDEX sy-tabix INTO DATA(ls_amdp).
      cl_abap_unit_assert=>assert_equals( act = ls_amdp-result_id exp = ls_anydb-result_id ).
      cl_abap_unit_assert=>assert_equals( act = ls_amdp-rank exp = ls_anydb-rank ).
      cl_abap_unit_assert=>assert_equals( act = ls_amdp-payload exp = ls_anydb-payload ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
