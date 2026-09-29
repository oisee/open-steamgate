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
* number at least the size asked for, the synthetic ones are removed and
* none are added, so the cube does not count a month twice.
*
* Client: the SELECTs and the DELETE name no MANDT, as on a system, where
* the logon client is implicit. The transpiler has no implicit client
* (ANORMALIES and CLAUDE.md, "no implicit MANDT"), so there they see the
* rows of every client; the rows written carry sy-mandt.
*
* Later tables go the same way: tools/gen-data.mjs's synthetic flight
* facts (ZSTG_FLIGHTFACT, STG_DATA_SCALE) become a ZCL_OSD_DEMO_FLIGHT
* over ZCL_OSD_DEMO_RANDOM and an ENSURE_FLIGHTS here, and BOOT reads one
* knob per table (docs/demo-data.md).
CLASS zcl_osd_demo_data DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.

    TYPES:
      BEGIN OF ty_year,
        year  TYPE i,
        rows  TYPE i,
        trips TYPE i,
      END OF ty_year.
    TYPES ty_years TYPE STANDARD TABLE OF ty_year WITH DEFAULT KEY.

    " what a host calls at start: iv_config is the host's knob
    " (OSD_DEMO_ROWS) as text. Empty (the default) makes nothing: a year of
    " rows is made on request (GENERATE_YEAR); n makes n rows of the one
    " sample month, for a test that needs them without a request; 0 removes
    " the synthetic rows
    CLASS-METHODS boot
      IMPORTING
        iv_config        TYPE string
      RETURNING
        VALUE(rv_report) TYPE string.
    " the years whose synthetic rows are present, oldest first, with their
    " rows and trips (synthetic rows of the sample month, from an older start
    " or the knob, are not a year and are not listed)
    CLASS-METHODS years
      RETURNING
        VALUE(rt_years) TYPE ty_years.
    " one year of synthetic rows (ZCL_OSD_DEMO_TAXI=>GENERATE_YEAR), unless
    " that year has rows already: then nothing is written and the report
    " says so. Other years are not touched. The caller owns the LUW
    CLASS-METHODS generate_year
      IMPORTING
        iv_year          TYPE i
      RETURNING
        VALUE(rv_report) TYPE string.
    " back to the minimal data: every synthetic row goes, the sample rows
    " (below C_SYNTHETIC_MIN, data/zosd_taxifact.tabu.json) stay. Nothing to
    " remove is reported, not an error. The caller owns the LUW
    CLASS-METHODS reset
      RETURNING
        VALUE(rv_report) TYPE string.
    " exactly iv_rows synthetic rows of seed iv_seed in the sample month's
    " key range, unless real rows already number at least iv_rows; a year's
    " rows (GENERATE_YEAR) are not touched
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
      rv_report = `taxi: nothing generated at start; a year of rows is made on request`.
      RETURN.
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

  METHOD years.
    TYPES:
      BEGIN OF ty_row,
        fact_id TYPE zcl_osd_demo_taxi=>ty_fact-fact_id,
        trips   TYPE i,
      END OF ty_row.
    DATA lt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA ls_row TYPE ty_row.
    DATA ls_year TYPE ty_year.
    DATA lv_n4 TYPE n LENGTH 4.
    FIELD-SYMBOLS <ls_year> TYPE ty_year.
    SELECT fact_id trips FROM zosd_taxifact INTO TABLE lt_rows
      WHERE fact_id > zcl_osd_demo_taxi=>c_synthetic_min.
    LOOP AT lt_rows INTO ls_row.
      lv_n4 = ls_row-fact_id+1(4).
      " the sample month's keys are 9000000001 and up: year 0, not a year
      IF lv_n4 < '1900'.
        CONTINUE.
      ENDIF.
      READ TABLE rt_years ASSIGNING <ls_year> WITH KEY year = lv_n4.
      IF sy-subrc <> 0.
        CLEAR ls_year.
        ls_year-year = lv_n4.
        APPEND ls_year TO rt_years ASSIGNING <ls_year>.
      ENDIF.
      <ls_year>-rows = <ls_year>-rows + 1.
      <ls_year>-trips = <ls_year>-trips + ls_row-trips.
    ENDLOOP.
    SORT rt_years BY year.
  ENDMETHOD.

  METHOD generate_year.
    DATA lt_new TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lv_low TYPE zcl_osd_demo_taxi=>ty_fact-fact_id.
    DATA lv_high TYPE zcl_osd_demo_taxi=>ty_fact-fact_id.
    DATA lv_rows TYPE i.
    DATA lv_trips TYPE i.
    FIELD-SYMBOLS <ls_new> TYPE zcl_osd_demo_taxi=>ty_fact.
    IF iv_year < 1900 OR iv_year > 2099.
      rv_report = |taxi: { iv_year } is not a year this generator makes (1900 to 2099)|.
      RETURN.
    ENDIF.
    lv_low = zcl_osd_demo_taxi=>year_low( iv_year ).
    lv_high = zcl_osd_demo_taxi=>year_high( iv_year ).
    SELECT COUNT(*) FROM zosd_taxifact INTO lv_rows WHERE fact_id BETWEEN lv_low AND lv_high.
    IF lv_rows > 0.
      SELECT SUM( trips ) FROM zosd_taxifact INTO lv_trips WHERE fact_id BETWEEN lv_low AND lv_high.
      rv_report = |taxi: { iv_year } already has { lv_trips } trips in { lv_rows } rows; nothing written|.
      RETURN.
    ENDIF.
    lt_new = zcl_osd_demo_taxi=>generate_year( iv_year ).
    lv_trips = 0.
    LOOP AT lt_new ASSIGNING <ls_new>.
      <ls_new>-mandt = sy-mandt.
      lv_trips = lv_trips + <ls_new>-trips.
    ENDLOOP.
    INSERT zosd_taxifact FROM TABLE lt_new.
    lv_rows = lines( lt_new ).
    rv_report = |taxi: { iv_year } generated, { lv_trips } trips in { lv_rows } rows (synthetic; | &&
      |{ zcl_osd_demo_taxi=>profile( iv_year ) })|.
  ENDMETHOD.

  METHOD reset.
    DATA lt_years TYPE ty_years.
    DATA ls_year TYPE ty_year.
    DATA lv_names TYPE string.
    DATA lv_rows TYPE i.
    DATA lv_month TYPE i.
    lt_years = years( ).
    SELECT COUNT(*) FROM zosd_taxifact INTO lv_rows WHERE fact_id > zcl_osd_demo_taxi=>c_synthetic_min.
    SELECT COUNT(*) FROM zosd_taxifact INTO lv_month
      WHERE fact_id > zcl_osd_demo_taxi=>c_synthetic_min AND fact_id <= zcl_osd_demo_taxi=>c_month_max.
    IF lv_rows = 0.
      rv_report = `taxi: already minimal, only the sample rows; nothing removed`.
      RETURN.
    ENDIF.
    DELETE FROM zosd_taxifact WHERE fact_id > zcl_osd_demo_taxi=>c_synthetic_min.
    LOOP AT lt_years INTO ls_year.
      IF lv_names IS NOT INITIAL.
        lv_names = lv_names && `, `.
      ENDIF.
      lv_names = lv_names && |{ ls_year-year }|.
    ENDLOOP.
    IF lv_month > 0.
      IF lv_names IS NOT INITIAL.
        lv_names = lv_names && ` and `.
      ENDIF.
      lv_names = lv_names && `the sample month`.
    ENDIF.
    rv_report = |taxi: removed { lv_rows } synthetic rows ({ lv_names }); the sample rows stay|.
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
    FIELD-SYMBOLS <ls_new> TYPE zcl_osd_demo_taxi=>ty_fact.
    lv_rows = iv_rows.
    IF lv_rows < 0.
      lv_rows = 0.
    ELSEIF lv_rows > zcl_osd_demo_taxi=>c_max_rows.
      lv_rows = zcl_osd_demo_taxi=>c_max_rows.
    ENDIF.
    SELECT COUNT(*) FROM zosd_taxifact INTO lv_real WHERE fact_id < zcl_osd_demo_taxi=>c_synthetic_min.
    IF lv_rows > 0 AND lv_real >= lv_rows.
      " real rows are enough: synthetic ones beside them would be counted
      " twice by the cube, so any left from an earlier start go
      DELETE FROM zosd_taxifact WHERE fact_id BETWEEN zcl_osd_demo_taxi=>c_synthetic_min AND zcl_osd_demo_taxi=>c_month_max.
      lv_n_old = sy-dbcnt.
      rv_report = |taxi: { lv_real } real rows, at least the { lv_rows } asked for; | &&
        |no synthetic rows, { lv_n_old } removed|.
      RETURN.
    ENDIF.
    lt_new = zcl_osd_demo_taxi=>generate( iv_rows = lv_rows
                                         iv_seed = iv_seed ).
    LOOP AT lt_new ASSIGNING <ls_new>.
      <ls_new>-mandt = sy-mandt.
    ENDLOOP.
    SELECT * FROM zosd_taxifact INTO TABLE lt_old WHERE fact_id BETWEEN zcl_osd_demo_taxi=>c_synthetic_min AND zcl_osd_demo_taxi=>c_month_max ORDER BY fact_id.
    lv_want = zcl_osd_demo_taxi=>checksum( lt_new ).
    lv_have = zcl_osd_demo_taxi=>checksum( lt_old ).
    lv_n_new = lines( lt_new ).
    lv_n_old = lines( lt_old ).
    IF lv_n_new = lv_n_old AND lv_want = lv_have.
      rv_report = |taxi: { lv_n_new } synthetic rows of seed { iv_seed } present (checksum { lv_want }); unchanged|.
      RETURN.
    ENDIF.
    DELETE FROM zosd_taxifact WHERE fact_id BETWEEN zcl_osd_demo_taxi=>c_synthetic_min AND zcl_osd_demo_taxi=>c_month_max.
    IF lv_n_new > 0.
      INSERT zosd_taxifact FROM TABLE lt_new.
    ENDIF.
    rv_report = |taxi: { lv_n_new } synthetic rows of seed { iv_seed } written (checksum { lv_want }), { lv_n_old } replaced|.
    IF lv_n_new < lv_rows.
      rv_report = rv_report && |; only { lv_n_new } of the { lv_rows } asked for fit the month's cells|.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
