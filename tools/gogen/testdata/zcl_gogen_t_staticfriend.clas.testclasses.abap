CLASS ltc DEFINITION DEFERRED.
CLASS zcl_gogen_t_staticfriend DEFINITION LOCAL FRIENDS ltc.
CLASS ltc DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS writes FOR TESTING.
ENDCLASS.
CLASS ltc IMPLEMENTATION.
  METHOD writes.
    DATA result TYPE xstring.
    DATA replacement TYPE x LENGTH 1 VALUE 'AB'.
    zcl_gogen_t_staticfriend=>gv_priv = '0102'.
    zcl_gogen_t_staticfriend=>gv_ro = '0304'.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF zcl_gogen_t_staticfriend=>gv_priv WITH replacement IN BYTE MODE.
    CONCATENATE zcl_gogen_t_staticfriend=>gv_priv zcl_gogen_t_staticfriend=>gv_ro INTO result IN BYTE MODE.
    cl_abap_unit_assert=>assert_equals( act = result exp = 'AB020304' ).
  ENDMETHOD.
ENDCLASS.
