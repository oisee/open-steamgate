* The seed of the RAP flight pack: SAP's own data generator, run once.
*
* /DMO/CL_FLIGHT_DATA_GENERATOR is an ADT class run (IF_OO_ADT_CLASSRUN)
* that fills the legacy tables and then, through a BAdI, the managed ones.
* This class gives it the console it asks for and calls it, so that a host
* (tools/rap-flight/seed-capture.mjs) can run it in one dialog step and
* write what it made into data/*.tabu.json -- the seed rows every start
* loads, the way the other packs carry theirs. The generator is random
* with fixed seeds where it matters (cl_abap_random_int seed = 1337 for the
* distances), so a second capture is the same rows where the original is.
*
* The two generator classes this calls are the pack's overlay copies
* (packs/rap-flight/src/#dmo#cl_*), changed only where open-abap-core has
* no number range intervals, no CL_ABAP_RANDOM_INT8 and the transpiler
* does not take four 7.40 constructs (README.md of the pack).
CLASS zcl_osd_rapflight_seed DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    " runs the generator; returns what it wrote to its console, one line each
    CLASS-METHODS run
      RETURNING VALUE(rt_log) TYPE string_table.

    " the row counts after a run, for a capture and for the unit test
    CLASS-METHODS counts
      RETURNING VALUE(rv_counts) TYPE string.

ENDCLASS.

CLASS zcl_osd_rapflight_seed IMPLEMENTATION.

  METHOD run.
    DATA lo_out TYPE REF TO lcl_out.
    DATA lo_generator TYPE REF TO /dmo/cl_flight_data_generator.
    CREATE OBJECT lo_out.
    CREATE OBJECT lo_generator.
    lo_generator->if_oo_adt_classrun~main( lo_out ).
    rt_log = lo_out->mt_lines.
  ENDMETHOD.

  METHOD counts.
    DATA lv_count TYPE i.
    SELECT COUNT( * ) FROM /dmo/travel INTO @lv_count.
    rv_counts = |travel={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/booking INTO @lv_count.
    rv_counts = |{ rv_counts } booking={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/travel_m INTO @lv_count.
    rv_counts = |{ rv_counts } travel_m={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/booking_m INTO @lv_count.
    rv_counts = |{ rv_counts } booking_m={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/booksuppl_m INTO @lv_count.
    rv_counts = |{ rv_counts } booksuppl_m={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/customer INTO @lv_count.
    rv_counts = |{ rv_counts } customer={ lv_count }|.
    SELECT COUNT( * ) FROM /dmo/flight INTO @lv_count.
    rv_counts = |{ rv_counts } flight={ lv_count }|.
  ENDMETHOD.

ENDCLASS.
