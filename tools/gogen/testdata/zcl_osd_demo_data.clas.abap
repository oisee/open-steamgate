* Demo data at start: the synthetic rows a demo table should hold, made by
* ZCL_OSD_DEMO_TAXI (and ZCL_OSD_DEMO_RANDOM) and written here, the same on
* every host that runs these classes -- transpiled on Node and in the
* browser preview, compiled to Go by tools/gogen (OSGo), and on a system.
*
* Why ABAP and not a script per host: one class, so no per-host logic can
* drift (CLAUDE.md, "a rule written once, next to its one caller, does not
* survive the second caller"). Hosts only pass the size through BOOT.
*
* Idempotence. ENSURE_TAXI generates the rows it wants, compares them with
* the synthetic rows present (number of rows and CHECKSUM) and writes only
* on a difference, so the same size and seed give the same table and a
* second call writes nothing. The caller owns the LUW: every host runs BOOT
* inside its dialog step (tools/osd-demo-data.mjs, OSGo's boot).
*
* Synthetic rows are FACT_ID 9000000001 and up (ZCL_OSD_DEMO_TAXI=>
* C_SYNTHETIC_MIN); a row below it -- the bundled sample, a real import by
* tools/import-nyc-taxi.mjs, which numbers from 0001000001 -- is never
* read into the comparison, changed or deleted. When real rows already
* number at least the size asked for, nothing synthetic is added.
*
* Later tables go the same way: tools/gen-data.mjs's synthetic flight
* facts (ZSTG_FLIGHTFACT, STG_DATA_SCALE) become a ZCL_OSD_DEMO_FLIGHT
* over ZCL_OSD_DEMO_RANDOM and an ENSURE_FLIGHTS here, and BOOT reads one
* knob per table (docs/demo-data.md).
CLASS zcl_osd_demo_data DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    CONSTANTS c_default_rows TYPE i VALUE 20000.

    " what a host calls at start: iv_config is the host's knob
    " (OSD_DEMO_ROWS) as text, empty for the default size, 0 for none
    CLASS-METHODS boot
      IMPORTING
        iv_config        TYPE string
      RETURNING
        VALUE(rv_report) TYPE string.
    " exactly iv_rows synthetic rows of seed iv_seed, unless real rows
    " already number at least iv_rows
    CLASS-METHODS ensure_taxi
      IMPORTING
        iv_rows          TYPE i
        iv_seed          TYPE i DEFAULT zcl_osd_demo_taxi=>c_default_seed
      RETURNING
        VALUE(rv_report) TYPE string.
ENDCLASS.



CLASS zcl_osd_demo_data IMPLEMENTATION.

  METHOD boot.
    DATA lv_config TYPE string.
    DATA lv_rows TYPE i.
    lv_config = iv_config.
    CONDENSE lv_config.
    IF lv_config IS INITIAL.
      lv_rows = c_default_rows.
    ELSEIF lv_config CO '0123456789'.
      IF strlen( lv_config ) > 7.
        lv_rows = zcl_osd_demo_taxi=>c_max_rows.
      ELSE.
        lv_rows = lv_config.
      ENDIF.
    ELSE.
      rv_report = `taxi: "` && lv_config && `" is not a number of rows; nothing done`.
      RETURN.
    ENDIF.
    rv_report = ensure_taxi( iv_rows = lv_rows ).
  ENDMETHOD.

  METHOD ensure_taxi.
    DATA lv_rows TYPE i.
    DATA lv_real TYPE i.
    DATA lt_new TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lt_old TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lv_want TYPE i.
    DATA lv_have TYPE i.
    DATA lv_n_new TYPE i.
    DATA lv_n_old TYPE i.
    lv_rows = iv_rows.
    IF lv_rows < 0.
      lv_rows = 0.
    ELSEIF lv_rows > zcl_osd_demo_taxi=>c_max_rows.
      lv_rows = zcl_osd_demo_taxi=>c_max_rows.
    ENDIF.
    SELECT COUNT(*) FROM zosd_taxifact INTO lv_real WHERE fact_id < zcl_osd_demo_taxi=>c_synthetic_min.
    IF lv_rows > 0 AND lv_real >= lv_rows.
      rv_report = |taxi: { lv_real } real rows, at least the { lv_rows } asked for; no synthetic rows added|.
      RETURN.
    ENDIF.
    lt_new = zcl_osd_demo_taxi=>generate( iv_rows = lv_rows
                                         iv_seed = iv_seed ).
    SELECT * FROM zosd_taxifact INTO TABLE lt_old WHERE fact_id >= zcl_osd_demo_taxi=>c_synthetic_min ORDER BY fact_id.
    lv_want = zcl_osd_demo_taxi=>checksum( lt_new ).
    lv_have = zcl_osd_demo_taxi=>checksum( lt_old ).
    lv_n_new = lines( lt_new ).
    lv_n_old = lines( lt_old ).
    IF lv_n_new = lv_n_old AND lv_want = lv_have.
      rv_report = |taxi: { lv_n_new } synthetic rows of seed { iv_seed } present (checksum { lv_want }); unchanged|.
      RETURN.
    ENDIF.
    DELETE FROM zosd_taxifact WHERE fact_id >= zcl_osd_demo_taxi=>c_synthetic_min.
    IF lv_n_new > 0.
      INSERT zosd_taxifact FROM TABLE lt_new.
    ENDIF.
    rv_report = |taxi: { lv_n_new } synthetic rows of seed { iv_seed } written (checksum { lv_want }), { lv_n_old } replaced|.
  ENDMETHOD.

ENDCLASS.
