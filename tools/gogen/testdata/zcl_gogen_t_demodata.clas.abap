* ZCL_OSD_DEMO_RANDOM and ZCL_OSD_DEMO_TAXI (src/demo_data on main, copied
* here byte for byte; semantics.mjs checks the copies against the
* checkout's): the 10000th step of the minimal standard from 1, then the
* first five rows, the totals and the checksum of 20000 rows of the
* default seed. EXPECT is what A4H answered for this class (2026-09-24,
* $ZOSG_TMP_0462) and what Node's transpiler answers. No database: both
* emitters run it (ZCL_GOGEN_T_DEMODB writes the table).
CLASS zcl_gogen_t_demodata DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_demodata IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lv_x TYPE i.
    DATA lv_s TYPE string.
    lv_x = 1.
    DO 10000 TIMES.
      lv_x = zcl_osd_demo_random=>step( lv_x ).
    ENDDO.
    lv_s = lv_x.
    rv = `pm:` && lv_s && ` `.
    lt = zcl_osd_demo_taxi=>generate( iv_rows = 20000 iv_seed = zcl_osd_demo_taxi=>c_default_seed ).
    rv = rv && zcl_osd_demo_taxi=>describe( it_facts = lt iv_first = 5 ).
  ENDMETHOD.
ENDCLASS.
