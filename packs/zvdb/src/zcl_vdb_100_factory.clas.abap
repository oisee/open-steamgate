CLASS zcl_vdb_100_factory DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create
      IMPORTING iv_mode TYPE string OPTIONAL
      RETURNING VALUE(ro_engine) TYPE REF TO zif_vdb_100_engine.
ENDCLASS.

CLASS zcl_vdb_100_factory IMPLEMENTATION.
  METHOD create.
    DATA(lv_mode) = to_upper( iv_mode ).
    IF lv_mode = 'ANYDB'.
      ro_engine = NEW zcl_vdb_100_anydb( ).
    ELSEIF lv_mode = 'HANA' OR lv_mode = 'AMDP'.
      ro_engine = NEW zcl_vdb_100_hana( ).
    ELSEIF lv_mode IS INITIAL AND sy-dbsys = 'HDB'.
      ro_engine = NEW zcl_vdb_100_hana( ).
    ELSEIF lv_mode IS INITIAL.
      ro_engine = NEW zcl_vdb_100_anydb( ).
    ELSE.
      RAISE EXCEPTION TYPE cx_sy_conversion_error.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
