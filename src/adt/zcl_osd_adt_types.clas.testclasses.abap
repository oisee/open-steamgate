CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS catalog FOR TESTING RAISING cx_static_check.
    METHODS uris FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD catalog.
    DATA lt_all TYPE zcl_osd_adt_types=>tt_type.
    DATA lt_sources TYPE zcl_osd_adt_types=>tt_type.
    DATA lt_lockable TYPE zcl_osd_adt_types=>tt_type.
    lt_all = zcl_osd_adt_types=>all( ).
    lt_sources = zcl_osd_adt_types=>sources( ).
    lt_lockable = zcl_osd_adt_types=>lockable( ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_all ) exp = 15 ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_sources ) exp = 6 ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_lockable ) exp = 7 ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_types=>adt_type( `STRU` ) exp = `TABL/DS` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_types=>type_of_collection( `oo/classes` ) exp = `CLAS` ).
  ENDMETHOD.
  METHOD uris.
    DATA ls_object TYPE zcl_osd_adt_types=>ty_object.
    ls_object = zcl_osd_adt_types=>object_from_uri( `/sap/bc/adt/oo/classes/%2fdemo%2fcl/source/main?x#y` ).
    cl_abap_unit_assert=>assert_equals( act = ls_object-name exp = `/DEMO/CL` ).
    cl_abap_unit_assert=>assert_equals( act = ls_object-type exp = `CLAS` ).
    cl_abap_unit_assert=>assert_true( ls_object-ok ).
    ls_object = zcl_osd_adt_types=>object_from_uri( `/SAP/bc/adt/oo/classes/zcl_demo` ).
    cl_abap_unit_assert=>assert_false( ls_object-found ).
    ls_object = zcl_osd_adt_types=>object_from_uri( `/sap/bc/adt/oo/classes/%zz` ).
    cl_abap_unit_assert=>assert_false( ls_object-ok ).
  ENDMETHOD.
ENDCLASS.
