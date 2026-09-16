CLASS zcl_zosd_test_mpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zosd_test_mpc
  CREATE PUBLIC.

* The model extension a developer owns. The generated ZCL_ZOSD_TEST_MPC
* beside it (gen/stg/, written from zosd_test.stg.yaml) carries the model
* itself; this class is where a change to it would go, and it is empty on
* purpose: the reference package shows the shape, not a feature.

  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zosd_test_mpc_ext IMPLEMENTATION.
ENDCLASS.
