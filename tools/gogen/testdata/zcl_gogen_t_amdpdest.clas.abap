* CALL FUNCTION ... DESTINATION 'AMDP' on a host without HANA, and sy-dbsys /
* sy-saprl. Not A4H values: A4H has no destination AMDP, and its sy says HDB
* and 758. What this pins is parity with OSG on Node (tools/amdp-destination.mjs
* raises CX_SY_DYN_CALL_ILLEGAL_FUNC before any parameter is passed; sy-dbsys
* is the database client's name, sy-saprl the transpiler runtime's 'OPEN').
CLASS zcl_gogen_t_amdpdest DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_amdpdest IMPLEMENTATION.
  METHOD run.
    DATA lv_out TYPE string.
    DATA lv_rel TYPE string.
    rv = 'before'.
    TRY.
        CALL FUNCTION 'ZGOGEN_T_NO_SUCH_FM' DESTINATION 'AMDP'
          EXPORTING iv_body   = `SELECT 1 FROM dummy;`
          IMPORTING ev_result = lv_out.
        rv = 'ran'.
      CATCH cx_sy_dyn_call_illegal_func.
        rv = 'illegal_func'.
    ENDTRY.
    lv_rel = sy-saprl.
    CONDENSE lv_rel.
    rv = |{ rv } out:[{ lv_out }] db:[{ sy-dbsys }] rel:[{ lv_rel }]|.
  ENDMETHOD.
ENDCLASS.
