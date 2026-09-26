CLASS zcl_osd_classrun_dumper DEFINITION PUBLIC CREATE PUBLIC.
* A tracked fixture for the classrun route's rollback-and-record path
* (Q6b, tools/osd-classrun.mjs): writes something, then dumps. Built the
* normal way (npm run transpile), so a test or the live smoke can classrun
* it directly with no write/activate dance of its own -- see
* tools/osd-classrun.mjs's own comment on `importFresh` for why an
* activate-then-classrun sequence within one process is not the same test.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_osd_classrun_dumper IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    DATA lv_zero TYPE i VALUE 0.
    out->write( 'before the dump' ).
    out->write( 1 / lv_zero ).
  ENDMETHOD.

ENDCLASS.
