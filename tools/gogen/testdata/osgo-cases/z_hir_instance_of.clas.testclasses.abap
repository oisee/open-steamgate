CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA(same) = NEW z_hir_instance_of( ).
DATA(child) = NEW z_hir_instance_child( ).
DATA(other) = NEW z_hir_instance_other( ).
DATA(intf) = NEW z_hir_instance_impl( ).
DATA initial TYPE REF TO z_hir_instance_of.
DATA initial_object TYPE REF TO object.
DATA initial_intf TYPE REF TO zcl_hir_instance_intf.
DATA initial_impl TYPE REF TO z_hir_instance_impl.
cl_abap_unit_assert=>assert_equals( act = xsdbool( same IS INSTANCE OF z_hir_instance_of ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( child IS INSTANCE OF z_hir_instance_of ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( other IS INSTANCE OF z_hir_instance_of ) exp = abap_false ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( intf IS INSTANCE OF zcl_hir_instance_intf ) exp = abap_true ).
" an initial reference answers by its static type (A4H 7.58, 2026-10-08)
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial IS INSTANCE OF z_hir_instance_of ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial IS NOT INSTANCE OF z_hir_instance_of ) exp = abap_false ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial IS INSTANCE OF z_hir_instance_child ) exp = abap_false ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial_object IS INSTANCE OF z_hir_instance_of ) exp = abap_false ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial_intf IS INSTANCE OF zcl_hir_instance_intf ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( initial_impl IS INSTANCE OF zcl_hir_instance_intf ) exp = abap_true ).
IF same IS INSTANCE OF z_hir_instance_of.
ELSE.
  cl_abap_unit_assert=>fail( ).
ENDIF.
ENDMETHOD.
ENDCLASS.
