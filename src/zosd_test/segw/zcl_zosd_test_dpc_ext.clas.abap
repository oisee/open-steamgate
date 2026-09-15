CLASS zcl_zosd_test_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zosd_test_dpc
  CREATE PUBLIC.

* The data provider a service is registered against (ZOSD_TEST_SRV in
* zosd_test_srv 0001.iwsv.xml). Every operation of ItemSet is served by
* SADL over the dictionary table ZOSD_TEST_ITEM, which the generated
* ZCL_ZOSD_TEST_DPC delegates to, so this class has nothing to add.

  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zosd_test_dpc_ext IMPLEMENTATION.
ENDCLASS.
