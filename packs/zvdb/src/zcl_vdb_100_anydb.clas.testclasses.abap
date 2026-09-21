CLASS ltcl_rank DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS identical FOR TESTING.
    METHODS opposite FOR TESTING.
    METHODS one_bit FOR TESTING.
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
ENDCLASS.
