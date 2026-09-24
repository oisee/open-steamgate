* ZCL_OSD_DEMO_DATA=>ENSURE_TAXI and BOOT on ZOSD_TAXIFACT: written,
* unchanged, replaced by another size, removed. Not an A4H value: what
* Node's transpiler answers for the same calls (A4H has no ZOSD_TAXIFACT:
* its ZONE column is a reserved word in the dictionary there). Starts from
* no synthetic rows.
CLASS zcl_gogen_t_demodb DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_demodb IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE zcl_osd_demo_taxi=>ty_facts.
    zcl_osd_demo_data=>ensure_taxi( iv_rows = 0 ).
    rv = zcl_osd_demo_data=>ensure_taxi( iv_rows = 300 iv_seed = 9 ).
    rv = rv && ` | ` && zcl_osd_demo_data=>ensure_taxi( iv_rows = 300 iv_seed = 9 ).
    SELECT * FROM zosd_taxifact INTO TABLE lt WHERE fact_id >= zcl_osd_demo_taxi=>c_synthetic_min ORDER BY fact_id.
    rv = rv && ` | ` && zcl_osd_demo_taxi=>describe( it_facts = lt iv_first = 2 ).
    rv = rv && ` | ` && zcl_osd_demo_data=>ensure_taxi( iv_rows = 100 iv_seed = 9 ).
    rv = rv && ` | ` && zcl_osd_demo_data=>boot( `0` ).
  ENDMETHOD.
ENDCLASS.
