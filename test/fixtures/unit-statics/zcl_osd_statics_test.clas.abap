* Statics of a class under test, per ABAP Unit test class: on a system each
* test class runs in a fresh internal session, so the class constructor runs
* again and CLASS-DATA starts over, while the methods of one test class share
* them (measured on A4H by foreman-dell, 2026-09-30). Go now resets them;
* Node still carries them over: ANOMALY-2026-09-30-unit-statics-across-
* test-classes. A fixture, not a suite member, until Node is fixed.
CLASS zcl_osd_statics_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_constructed TYPE i READ-ONLY.
    CLASS-DATA gv_count TYPE i READ-ONLY.
    CLASS-DATA gv_seed TYPE i VALUE 7 READ-ONLY.
    CLASS-METHODS class_constructor.
    CLASS-METHODS bump RETURNING VALUE(rv_count) TYPE i.
    CLASS-METHODS constructed RETURNING VALUE(rv_times) TYPE i.
    CLASS-METHODS seeded RETURNING VALUE(rv_seed) TYPE i.
ENDCLASS.

CLASS zcl_osd_statics_test IMPLEMENTATION.
  METHOD class_constructor.
    gv_constructed = gv_constructed + 1.
  ENDMETHOD.

  METHOD bump.
    gv_count = gv_count + 1.
    rv_count = gv_count.
  ENDMETHOD.

  METHOD constructed.
    rv_times = gv_constructed.
  ENDMETHOD.

  METHOD seeded.
    rv_seed = gv_seed.
    gv_seed = gv_seed + 1.
  ENDMETHOD.
ENDCLASS.
