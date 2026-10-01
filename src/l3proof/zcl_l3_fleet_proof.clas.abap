* The ABAP Unit proof of the L3 runner ZCL_L3_FLEET (docs/dsl-l3.md, "Proof").
* The tests are in the test include and run unchanged on this runtime and on
* a system; this class only carries them and has no use outside a test run.
CLASS zcl_l3_fleet_proof DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    " the check date of every run the proof makes: no other log group uses
    " it, so a run's MODIFY and tail DELETE touch only the proof's own rows
    CONSTANTS c_check_date TYPE d VALUE '20991001'.
ENDCLASS.

CLASS zcl_l3_fleet_proof IMPLEMENTATION.
ENDCLASS.
